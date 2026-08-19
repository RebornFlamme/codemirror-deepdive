import { ChangeDesc, ChangeSet } from "./change";

// je suis passé assez vite sur ce fichier qui est très technique

// assoc : une position est un interstice entre 2 caractères : à quel voisin est-elle collée? 

// Un seul entier pour trois informations, parce qu'une plage est réallouée à
// chaque transaction. Même motif que l'enum Open du bloc A, en plus gros.
//
//   bits 0-2   niveau bidi          7 = non renseigné
//   bit  3     AssocBefore          |
//   bit  4     AssocAfter           | mutuellement exclusifs, aucun des deux = 0
//   bit  5     (Inverted chez CM6)  ← inutilisé ici : on en a fait un champ
//   bits 6+    goal column          0xffffff = absent
//
// Les valeurs sont celles de CM6 à l'identique, pour que la comparaison avec le
// source reste ligne à ligne. Le bit 5 reste donc vide.
const enum RangeFlag {
    BidiLevelMask = 7,
    AssocBefore = 8,
    AssocAfter = 16,
    Inverted = 32,
    GoalColumnOffset = 6,
    NoGoalColumn = 0xffffff,
}

export class SelectionRange {
    from: number;
    to: number;
    inverted: boolean;
    flags: number

    constructor(from: number, to: number, inverted: boolean, flags: number) {
        this.from = from;
        this.to = to;
        this.inverted = inverted; 
        this.flags = flags;
    }

    get anchor(): number {
        return this.inverted ? this.to : this.from;
    }

    get head(): number {
        return this.inverted ? this.from : this.to;
    }

    get empty(): boolean {
        return this.from === this.to;
    }

    // Le côté auquel le curseur est collé. Aucun des deux bits = 0, « pas
    // d'association ». Client principal : le rendu, au point de retour à la
    // ligne, où une position logique a deux places à l'écran.
    get assoc(): -1 | 0 | 1 {
        return this.flags & RangeFlag.AssocBefore ? -1
            : this.flags & RangeFlag.AssocAfter ? 1
            : 0;
    }

    // Niveau de l'algorithme bidi Unicode : pair = gauche-à-droite, impair =
    // droite-à-gauche. Sur 3 bits, donc 0 à 7 — et les niveaux réels ne
    // dépassent pas 6, ce qui laisse 7 libre pour coder « non renseigné ».
    get bidiLevel(): number | null {
        const level = this.flags & RangeFlag.BidiLevelMask;
        return level === 7 ? null : level;
    }

    // La colonne visée en navigation verticale : descendre à travers une ligne
    // courte ne doit pas la « manger ». Stockée dans les bits de poids fort, on
    // la récupère donc par un décalage à droite, pas par un masque.
    get goalColumn(): number | undefined {
        const value = this.flags >> RangeFlag.GoalColumnOffset;
        return value === RangeFlag.NoGoalColumn ? undefined : value;
    }

    // Faire survivre la plage à une modification. C'est ici que le bloc B2 sert.
    map(change: ChangeDesc, assoc = -1): SelectionRange {
        let from: number;
        let to: number;

        if (this.empty) {
            // Un curseur : une seule position, et c'est l'appelant qui dit de
            // quel côté il est collé.
            from = to = change.mapPos(this.from, assoc);
        } else {
            // Une plage non vide IGNORE l'assoc reçu et impose 1 au début,
            // -1 à la fin : chaque borne se colle au texte qui est DANS la
            // plage. Sans ça, du texte inséré pile à une frontière serait avalé
            // dedans et la sélection grossirait toute seule à chaque frappe.
            from = change.mapPos(this.from, 1);
            to = change.mapPos(this.to, -1);
        }

        // Rien n'a bougé : rendre `this`, pas une copie. Identité physique,
        // comme Text.empty au bloc A5 — les comparaisons en aval deviennent
        // des `===` au lieu de parcours.
        return from === this.from && to === this.to
            ? this
            : new SelectionRange(from, to, this.inverted, this.flags);
    }

    // Comparaison par POSITION, pas par contenu de flags : deux plages égales
    // peuvent avoir des niveaux bidi différents sans que ça compte. L'assoc
    // n'est comparé que si on le demande, et seulement pour un curseur — sur
    // une plage non vide il est déduit du sens, donc redondant.
    eq(other: SelectionRange, includeAssoc = false): boolean {
        return this.anchor === other.anchor &&
            this.head === other.head &&
            this.goalColumn === other.goalColumn &&
            (!includeAssoc || !this.empty || this.assoc === other.assoc);
    }

}


export class EditorSelection {

    // Invariant à garantir par `create` : les plages sont triées par `from` et
    // ne se recouvrent pas — elles peuvent se toucher si elles ne sont pas vides.
    readonly ranges: readonly SelectionRange[];
    readonly mainIndex: number;

    private constructor(ranges: readonly SelectionRange[], mainIndex: number) {
        this.ranges = ranges;
        this.mainIndex = mainIndex;
    }

    // Un curseur : une plage vide, donc jamais inversée.
    //
    // Avec `range`, c'est le seul endroit du fichier qui ÉCRIT dans `flags`.
    // Les trois informations optionnelles s'assemblent au `|`, chacune avec sa
    // valeur « absent » : rien du tout pour assoc, 7 pour le bidi (les niveaux
    // réels s'arrêtent à 6), NoGoalColumn décalé pour la colonne visée.
    static cursor(
        pos: number,
        assoc = 0,
        bidiLevel?: number,
        goalColumn?: number,
    ): SelectionRange {
        return new SelectionRange(pos, pos, false,
            (assoc === 0 ? 0 : assoc < 0 ? RangeFlag.AssocBefore : RangeFlag.AssocAfter) |
            (bidiLevel == null ? 7 : Math.min(6, bidiLevel)) |
            ((goalColumn ?? RangeFlag.NoGoalColumn) << RangeFlag.GoalColumnOffset));
    }

    // Une plage orientée. Deux choses en plus de `cursor` :
    //
    // 1. NORMALISER — la plage stocke from <= to, et retient le sens à part.
    // 2. DEVINER l'assoc quand on ne le donne pas : une plage non vide est
    //    collée au caractère qui la prolonge dans son sens de tirage. Sans ça,
    //    du texte inséré à sa frontière serait avalé dedans.
    static range(
        anchor: number,
        head: number,
        goalColumn?: number,
        bidiLevel?: number,
        assoc?: number,
    ): SelectionRange {
        // La part des flags qui ne dépend ni du sens ni de l'assoc.
        const flags =
            ((goalColumn ?? RangeFlag.NoGoalColumn) << RangeFlag.GoalColumnOffset) |
            (bidiLevel == null ? 7 : Math.min(6, bidiLevel));

        if (!assoc && anchor !== head) assoc = head < anchor ? 1 : -1;

        // Tirée vers l'arrière : from = head, to = anchor, et on retient
        // l'inversion. L'assoc y vaut forcément 1, d'où AssocAfter en dur.
        if (head < anchor) {
            return new SelectionRange(head, anchor, true, RangeFlag.AssocAfter | flags);
        }

        return new SelectionRange(anchor, head, false,
            (!assoc ? 0 : assoc < 0 ? RangeFlag.AssocBefore : RangeFlag.AssocAfter) | flags);
    }

    // La plage principale : celle qui a été ajoutée en dernier, celle que les
    // commandes mono-curseur utilisent.
    get main(): SelectionRange {
        return this.ranges[this.mainIndex];
    }

    // Faire survivre toute la sélection à une modification.
    //
    // Le passage par `create` n'est pas décoratif : après une suppression, deux
    // curseurs distincts peuvent atterrir au même endroit et doivent fusionner.
    // C'est la seule chose que `map` fait de plus que mapper chaque plage.
    map(change: ChangeDesc, assoc = -1): EditorSelection {
        // Rien n'a changé : identité physique, comme dans SelectionRange.map.
        if (change.empty) return this;
        return EditorSelection.create(
            this.ranges.map(range => range.map(change, assoc)),
            this.mainIndex,
        );
    }

    eq(other: EditorSelection, includeAssoc = false): boolean {
        if (this.ranges.length !== other.ranges.length ||
            this.mainIndex !== other.mainIndex) return false;
        for (let i = 0; i < this.ranges.length; i++) {
            if (!this.ranges[i].eq(other.ranges[i], includeAssoc)) return false;
        }
        return true;
    }

    // LE point d'entrée : personne ne construit une EditorSelection autrement.
    //
    // L'invariant : plages triées par `from`, sans recouvrement — mais elles
    // peuvent se TOUCHER si elles ne sont pas vides.
    //
    // On vérifie d'abord en une passe, et on ne paie la normalisation (tri +
    // fusion, avec allocation) que si l'invariant est violé. Le cas courant —
    // une sélection déjà correcte — ne coûte rien.
    static create(ranges: readonly SelectionRange[], mainIndex = 0): EditorSelection {
        if (ranges.length === 0) {
            throw new RangeError("Une sélection a besoin d'au moins une plage");
        }

        for (let pos = 0, i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            // Le test DIFFÈRE selon que la plage est vide, et c'est voulu :
            //   vide     : `<= pos` → deux curseurs au même point fusionnent
            //              (visuellement un seul curseur, et taper insérerait
            //              deux fois au même endroit) ;
            //   non vide : `< pos`  → deux plages qui se touchent restent deux
            //              sélections légitimes.
            if (range.empty ? range.from <= pos : range.from < pos) {
                return EditorSelection.normalized(ranges.slice(), mainIndex);
            }
            pos = range.to;
        }

        return new EditorSelection(ranges, mainIndex);
    }

    // Trie et fusionne. Prend un tableau MUTABLE — `create` lui passe une copie.
    static normalized(ranges: SelectionRange[], mainIndex = 0): EditorSelection {
        // On retient la plage principale par identité, pas par indice : le tri
        // va déplacer les indices sous nos pieds.
        const main = ranges[mainIndex];
        ranges.sort((a, b) => a.from - b.from);
        mainIndex = ranges.indexOf(main);

        for (let i = 1; i < ranges.length; i++) {
            const range = ranges[i];
            const prev = ranges[i - 1];

            if (range.empty ? range.from <= prev.to : range.from < prev.to) {
                const from = prev.from;
                const to = Math.max(range.to, prev.to);

                // Une plage disparaît avant l'indice principal : il recule.
                if (i <= mainIndex) mainIndex--;

                // Remplace les deux plages par leur union, en conservant le SENS
                // de celle qu'on absorbe. Le `--i` fait repointer la boucle sur
                // la plage fusionnée, pour qu'elle puisse fusionner encore.
                ranges.splice(--i, 2, range.anchor > range.head
                    ? EditorSelection.range(to, from)
                    : EditorSelection.range(from, to));
            }
        }

        return new EditorSelection(ranges, mainIndex);
    }

    // Une sélection à une seule plage. `head` absent → un curseur.
    //
    // Deux choses déléguées, et c'est le point :
    //   - `range` normalise le sens, devine l'assoc et pose les SENTINELLES
    //     (7 pour le bidi, NoGoalColumn pour la colonne). Construire la plage
    //     à la main avec flags = 0 mentirait : bidiLevel rendrait 0 au lieu de
    //     null, et goalColumn 0 au lieu de undefined ;
    //   - on appelle le constructeur DIRECTEMENT, pas `create` : une seule
    //     plage ne peut pas violer l'invariant, il n'y a rien à trier ni à
    //     fusionner. C'est le chemin le plus fréquent du fichier.
    static single(anchor: number, head: number = anchor): EditorSelection {
        return new EditorSelection([EditorSelection.range(anchor, head)], 0);
    }

    // Ne garder que la plage principale : les commandes qui refusent le
    // multi-curseur passent par là.
    asSingle(): EditorSelection {
        // on préserve l'égalité physique au maximum !
        if (this.ranges.length === 1) {
            return(this);
        } else {
            return(new EditorSelection([this.main], 0))
        }
    }

    // Ajouter un curseur — le Ctrl+clic de l'utilisateur.
    addRange(range: SelectionRange, main: boolean = true): EditorSelection {
        // La nouvelle plage se met EN TÊTE, donc l'indice principal actuel se
        // décale de +1. Par défaut c'est la plage ajoutée qui devient
        // principale : c'est ce qu'on attend en Ctrl+cliquant.
        //
        // `create` remet ensuite dans l'ordre, et fusionne si le nouveau
        // curseur tombe sur un existant.
        return EditorSelection.create(
            [range].concat(this.ranges),
            main ? 0 : this.mainIndex + 1,
        );
    }

    // Remplacer une plage par une autre — par défaut la principale, c'est le
    // cas courant : déplacer le curseur principal sans toucher aux autres.
    replaceRange(range: SelectionRange, which: number = this.mainIndex): EditorSelection {
        const ranges = this.ranges.slice();
        ranges[which] = range;

        // `mainIndex` est passé INCHANGÉ, ce qui n'est correct que parce que
        // `normalized` retrouve la plage principale par identité et corrige
        // l'indice lui-même.
        return EditorSelection.create(ranges, this.mainIndex);
    }

}


// Fonction de module, pas méthode : ce n'est pas une propriété de la sélection.
// C'est une validation qu'EditorState fera en assemblant un état — la sélection
// seule ne connaît aucun document.
//
// Elle LÈVE : une sélection hors document est une incohérence, pas une borne à
// recadrer. Même convention que line/lineAt au bloc A.
export function checkSelection(selection: EditorSelection, docLength: number): void {
    for (const range of selection.ranges) {
        if (range.to > docLength) {
            throw new RangeError("La sélection pointe en dehors du document");
        }
    }
}