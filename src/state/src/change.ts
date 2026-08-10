import { Text } from './text';

// Explications limpides : 
// Bloc B — le changement comme valeur
//
// Fichier cible proposé : src/state/src/change.ts, important Text depuis ./text.ts. C'est exactement le découpage de CM6 (change.ts ne connaît que text.ts).
//
// Si on s'en tient à text.ts
//
// const doc2 = doc1.replace(5, 5, Text.of(["XYZ"]))
//
// Au retour de l'appel il ne reste que doc2. Le 5, le 5 et le "XYZ" sont morts sur la pile. Or cinq clients veulent interroger la modification après coup :
//
// ┌────────────────────────┬───────────────────────────────────────┐
// │         client         │              sa question              │
// ├────────────────────────┼───────────────────────────────────────┤
// │ undo (étape 5)         │ « inverse-toi »                       │
// ├────────────────────────┼───────────────────────────────────────┤
// │ curseur / sélection    │ « où est passée ma position 42 ? »    │
// │ (D1)                   │                                       │
// ├────────────────────────┼───────────────────────────────────────┤
// │ height map (étape 3)   │ « quelles lignes dois-je réinvalider  │
// │                        │ ? »                                   │
// ├────────────────────────┼───────────────────────────────────────┤
// │ rendu (étape 3)        │ « quelles plages redessiner ? »       │
// ├────────────────────────┼───────────────────────────────────────┤
// │ collaboration (C3)     │ « réécris-toi face à cette autre      │
// │                        │ modif »                               │
// └────────────────────────┴───────────────────────────────────────┘
// Le point non évident : quatre de ces cinq clients n'ont aucun besoin du texte inséré, ils ne veulent que la géométrie du changement. Et l'historique en stocke des milliers. D'où la scission de CM6 en deux classes :

// ChangeDesc          géométrie seule. Pas applicable. Bon marché.
//     ▲               C'est elle qui porte la cartographie des positions.
//     │ extends
// ChangeSet           + les textes insérés. Applicable.

// Le motif de découpe d'une insertion donnée sous forme de string.
// \r\n, \r seul et \n seul : les trois conventions de fin de ligne.
export const DefaultSplit = /\r\n?|\n/

// L'écriture commode d'un changement, côté appelant. Récursif : une liste de
// specs est une spec. CM6 accepte aussi un ChangeSet dans cette union — il
// faut compose/map pour le traiter, donc ce sera pour le bloc C.
export type ChangeSpec =
    | { from: number, to?: number, insert?: string | Text }
    | readonly ChangeSpec[]

export enum MapMode {
    Simple,
    TrackDel, 
    TrackBefore,
    TrackAfter
}

export class ChangeDesc {
    // Schéma de donnée
    // ici le but n'est de stocker aucun texte : seulement la géométrie du changement
    // une liste qui se lis par paire
    // (nb de caractères avant, nb de caractères après)
    // et il faut décrire toute la séquence
    // insertion : (0, 3)
    // inchangé (5, -1)
    // deletion (3, 0)
    // Insight : Cette représentation un peu farfelue présente de bonnes propriétés pour l'inversion par exemple

    readonly sections: readonly number[];

    constructor(sections: readonly number[]) {
        this.sections = sections;
    }

    get length(): number {
        let len = 0;
        for (let i = 0; i < this.sections.length ; i += 2) {
            len += this.sections[i];
        };
        return(len);
    }

    get newLength() {
        let len = 0;
        for (let i = 1 ; i < this.sections.length ; i += 2) {
            if (this.sections[i] < 0) {
                len += this.sections[i-1];
            } else {
                len += this.sections[i];
            }
        };
        return(len);
    }

    get empty() {
        return(
            this.sections.length === 0 || (this.sections.length == 2 && this.sections[1] < 0));
    }

    toString() {
        const representation: string[] = [];
        for (let i = 0 ; i < this.sections.length ; i += 2) {
            if (this.sections[i+1] < 0) {
                representation.push(String(this.sections[i]));
            } else {
                representation.push(`${this.sections[i]}:${this.sections[i+1]}`);
            }
        };
        return(representation.join(" "));
    }

    iterGaps(f: (posA: number, posB: number, length: number) => void) {
        // énumère les parties intactes et appelle la fonction f dessus
        let posA = 0;
        let posB = 0;
        for (let i = 0 ; i < this.sections.length ; i += 2) {
            
            const len = this.sections[i];
            const ins = this.sections[i+1]
            
            if (ins < 0) {
                // dans ce cas là la section est bien inchangée
                f(posA, posB, len);
                posB += len
            } else {
                posB += ins
            };
            posA += len;
        };
    }

    // Le parcours vit dans une fonction de module (voir tout en bas) : il est
    // partagé avec ChangeSet.iterChanges, qui a besoin du texte inséré en plus.
    // Ici on passe un `f` à quatre paramètres — JS ignore l'argument en trop.
    iterChangedRanges(
        f: (fromA: number, toA: number, fromB: number, toB: number) => void,
        individual = false,
    ) {
        iterChanges(this, f, individual);
    }

    // Idée : donner une position dans l'ancien document, rend la position dans le nouveau !
    // penser au curseur, si la plage a été supprimée, il faut mettre le curseur au point de suppression
    //
    // Deux signatures de surcharge, puis l'implémentation — qui n'est PAS
    // appelable de l'extérieur. Le type dit la règle : sans `mode`, on ne peut
    // pas recevoir null.
    mapPos(pos: number, assoc?: number): number
    mapPos(pos: number, assoc: number, mode: MapMode): number | null
    mapPos(pos: number, assoc = -1, mode: MapMode = MapMode.Simple): number | null {
        // comprendre assoc : 
        // une pos c'est un interstice entre 2 caractères ce n'est pas un caractère
        // question légitime : ou termine le curseur quand il y a une insertion à sa position 
        // avant ou après? assoc < 0 => avant assoc >= 0 => après 
        // assoc répond à la question de quelle côté, le smodes répondent à la question, faut-il suivre? 
        
        let posA = 0;
        let posB = 0;

        for (let i = 0; i < this.sections.length ; i += 2) {
            const len = this.sections[i];
            const ins = this.sections[i+1];
            const endA = posA + len;

            if (ins < 0) {
                // la section est alors intacte : le décalage est direct, `assoc`
                // et `mode` ne servent à rien ici. La première section dont la
                // fin dépasse `pos` est celle qui le contient.
                if (endA > pos) {
                    return posB + (pos - posA); // cette ligne se comprends bien !
                }
                posB += len;
            } else {
                // Section changée : le contexte de `pos` disparaît, il faut choisir.

                // Les trois modes de suivi, chacun avec sa définition du
                // « contexte ». Le `endA >= pos` commun écarte les sections déjà
                // dépassées ; les trois conditions qui suivent ne diffèrent que
                // par la place des inégalités strictes.
                if (mode != MapMode.Simple && endA >= pos &&
                    (mode == MapMode.TrackDel && posA < pos && endA > pos ||
                     mode == MapMode.TrackBefore && posA < pos ||
                     mode == MapMode.TrackAfter && endA > pos)) return null;

                // Deux façons d'être concerné par cette section :
                //   endA > pos                        → `pos` tombe dedans ;
                //   endA == pos && assoc < 0 && !len  → insertion pure exactement
                //     en `pos`, et on demande à rester collé au caractère d'avant.
                // Le `!len` est essentiel : sans lui, une position tombant sur la
                // FIN d'un remplacement serait capturée ici, au lieu d'être
                // traitée par la section suivante.
                if (endA > pos || endA == pos && assoc < 0 && !len) {
                    // Au tout début de la section, ou avec un assoc négatif :
                    // avant le contenu inséré. Sinon après.
                    return pos == posA || assoc < 0 ? posB : posB + ins;
                }

                posB += ins;
            }

            posA = endA;
        }

        // Sorti de la boucle : `pos` est la fin du document, qui n'appartient à
        // aucune section. Au-delà, l'interrogation est absurde → on lève.
        if (pos > posA) {
            throw new RangeError(
                `Position ${pos} hors du changement (document de ${posA} caractères)`,
            );
        }
        return posB;
    }

    get invertedDesc(): ChangeDesc {
        const sections = [];

        for (let i = 0 ; i < this.sections.length ; i += 2) {
            const len = this.sections[i];
            const ins = this.sections[i+1];

            if (ins < 0) {
                sections.push(len);
                sections.push(ins);
            } else {
                sections.push(ins);
                sections.push(len);
            }
        };
        return(new ChangeDesc(sections));
    }

    composeDesc(other: ChangeDesc): ChangeDesc {
        // Pourquoi c'est une méthode difficile? 
        // les 2 descriptions se basent sur le repère du document initial
        // donc il ne suffit pas d'appliquer les 2 change desc séquentiellement (ça veut rien dire en soit mais c'ets l'idée)
        // il faut refaire les positions du second change desc 
        
        throw new Error('Unimplemented')
    }
}


export class ChangeSet extends ChangeDesc {

    // la paire k occupe sections[2k] et sections[2k+1]
    // son texte inséré est inserted[k]
    // inserted[k] vaut Text.empty pour les sections qui n'inserent rien
    // et le tableau peut être PLUS COURT que le nombre de sections :
    // on ne bourre pas la queue, au-delà c'est Text.empty.
    readonly inserted: readonly Text[];

    constructor(sections: readonly number[], inserted: readonly Text[]) {
        super(sections);
        this.inserted = inserted;
    }

    // Même parcours qu'iterChangedRanges, plus le texte inséré par la plage.
    // `iterChanges` ci-dessous désigne la fonction de module, pas cette méthode :
    // les méthodes ne sont pas des identifiants dans la portée lexicale.
    iterChanges(
        f: (fromA: number, toA: number, fromB: number, toB: number, inserted: Text) => void,
        individual = false,
    ) {
        iterChanges(this, f, individual);
    }

    // Applique le changement à un document et rend le NOUVEAU document.
    // `doc` n'est jamais muté : chaque replace rend un nouvel arbre et on
    // réaffecte la variable locale.
    apply(doc: Text): Text {
        // Un ChangeSet est lié à une longueur de document : appliqué ailleurs,
        // ses positions ne veulent rien dire. Précondition violée → on lève.
        if (this.length !== doc.length) {
            throw new RangeError(
                `Ce changement décrit un document de ${this.length} caractères, pas ${doc.length}`,
            );
        }

        this.iterChanges((fromA, toA, fromB, _toB, inserted) => {
            // Bornes mixtes, et c'est volontaire. On avance de gauche à droite
            // en réécrivant `doc` : ce qui est à GAUCHE de la plage est déjà
            // dans le repère du nouveau document (d'où `fromB`), mais ce qui
            // est à DROITE ne l'est pas encore, donc la longueur à retirer est
            // celle de l'ancien (`toA - fromA`).
            //
            // Utiliser `toB` retirerait la longueur INSÉRÉE au lieu de la
            // longueur supprimée — juste seulement quand les deux coïncident.
            doc = doc.replace(fromB, fromB + (toA - fromA), inserted);
        });
        return doc;
    }

    static empty(length: number): ChangeSet {
        
        let sections: readonly number[] = []
        
        if (length > 0) {
            sections = [length, -1];
        };

        return new ChangeSet(sections, []);
    };

    // Construit la description canonique d'une ou plusieurs modifications
    // décrites en positions absolues, pour un document de `length` caractères.
    //
    // C'est le seul endroit qui FABRIQUE des sections — d'où le fait que la
    // normalisation (addSection) soit entièrement de son côté.
    static of(changes: ChangeSpec, length: number): ChangeSet {
        
        // ChangeSpec c'est {from, to, insert} avec les 2 derniers n'étant pas obligatoires
        // ou alors un tableau de ça
        
        const sections: number[] = [];
        const inserted: Text[] = [];

        // Position atteinte dans l'ancien document : tout ce qui est avant est
        // déjà décrit par une section.
        let pos = 0;

        function process(spec: ChangeSpec): void {
            if (Array.isArray(spec)) {
                for (const sub of spec as readonly ChangeSpec[]) process(sub);
                return;
            }

            const { from, to = from, insert } =
                spec as { from: number, to?: number, insert?: string | Text };

            if (from > to || from < 0 || to > length) {
                throw new RangeError(
                    `Plage de changement invalide : ${from} à ${to} (document de ${length})`,
                );
            }

            // SIMPLIFICATION assumée du bloc B : CM6 accepte ici des specs
            // désordonnées ou chevauchantes, qu'il compose entre elles. Composer,
            // c'est justement le bloc C — on lève en attendant.
            if (from < pos) {
                throw new RangeError(
                    `Changements non triés : ${from} arrive après la position ${pos}`,
                );
            }

            const insText = !insert ? Text.empty
                : typeof insert === "string" ? Text.of(insert.split(DefaultSplit))
                : insert;

            // Ne rien retirer et ne rien insérer ne décrit rien.
            if (from === to && insText.length === 0) return;

            // La partie intacte laissée entre le changement précédent et celui-ci.
            if (from > pos) addSection(sections, from - pos, -1);

            addSection(sections, to - from, insText.length);
            addInsert(inserted, sections, insText);
            pos = to;
        }

        process(changes);

        // La queue intacte du document. C'est elle qui garantit la couverture
        // totale : somme(len) === length, y compris quand rien ne change.
        if (pos < length) addSection(sections, length - pos, -1);

        return new ChangeSet(sections, inserted);
    }

    // L'inverse de ce changement : appliqué au document que `this` PRODUIT, il
    // redonne `doc`. C'est littéralement l'undo de l'étape 5.
    //
    // `doc` est le document d'AVANT, et il est indispensable : la description
    // sait qu'elle a supprimé n caractères, elle ne sait pas lesquels. Il faut
    // aller les relire — c'est tout le point de C1.
    //
    // (Ne pas confondre avec `invertedDesc.apply(...)` : ici on CONSTRUIT un
    // ChangeSet, on n'applique rien. Un cast ne fabriquerait pas `inserted`.)
    invert(doc: Text): ChangeSet {
        // fabrique le changement qui undo this. 
        // sauf que là on est pas dans ChangeDesc, on a besoin de connaitre les caractères supprimés
        // pour les remettre plus tard, d'ou l'interet d'avoir doc en argument


        // Copie mutable : on échange len et ins en place, section par section.
        const sections = this.sections.slice();
        const inserted: Text[] = [];

        // pos parcourt l'ANCIEN document. Il avance pour TOUTES les sections,
        // intactes comprises : c'est un compteur de position, pas de contenu.
        // Même piège que le cumLength de decompose au bloc A3.
        let pos = 0;

        for (let i = 0 ; i < sections.length ; i += 2) {
            // Lus AVANT l'échange, sinon on relit ce qu'on vient d'écrire.
            const len = sections[i];
            const ins = sections[i + 1];

            if (ins >= 0) {
                sections[i] = ins;
                sections[i + 1] = len;

                // Même discipline d'indexation que addInsert : inserted[k] pour
                // la section k, bourré de Text.empty jusque-là.
                const k = i >> 1;
                while (inserted.length < k) inserted.push(Text.empty);

                // len === 0 : c'était une insertion pure, elle n'avait rien
                // supprimé — son inverse est une suppression pure, rien à
                // réinsérer.
                inserted.push(len ? doc.slice(pos, pos + len) : Text.empty);
            }

            pos += len;
        }

        return new ChangeSet(sections, inserted);
    }

    compose(other: ChangeSet): ChangeSet {
        throw Error('unimplemented')
    }

}


// Ajoute une section en maintenant la FORME CANONIQUE. C'est le seul endroit
// du fichier qui écrit dans `sections`, donc la forme est garantie par
// construction : personne ne peut fabriquer une description non normalisée.
//
// Quatre règles, et une absence de règle qui compte autant :
// un remplacement (len > 0 et ins > 0) ne fusionne JAMAIS avec son voisin.
// Deux changements adjacents restent deux sections, parce que mapPos doit
// pouvoir les distinguer ; leur fusion se joue au moment du rapport, via le
// drapeau `individual` d'iterChangedRanges.
function addSection(sections: number[], len: number, ins: number): void {
    // 1. Une section qui ne consomme rien et n'insère rien ne décrit rien.
    if (len === 0 && ins <= 0) return;

    const last = sections.length - 2;

    if (last >= 0 && ins <= 0 && ins === sections[last + 1]) {
        // 2. et 3. Deux sections intactes adjacentes fusionnent (ins === -1 des
        // deux côtés), et deux suppressions pures adjacentes aussi (ins === 0).
        // Le `ins === sections[last + 1]` interdit de mélanger les deux.
        sections[last] += len;
    } else if (last >= 0 && len === 0 && sections[last] === 0) {
        // 4. Deux insertions pures adjacentes : leurs longueurs s'additionnent.
        sections[last + 1] += ins;
    } else {
        sections.push(len, ins);
    }
}

// Range le texte inséré à l'indice de sa section. Doit être appelée APRÈS
// l'addSection correspondante : elle lit la longueur de `sections` pour savoir
// de quelle section il s'agit.
function addInsert(values: Text[], sections: readonly number[], value: Text): void {
    if (value.length === 0) return;

    // La section qui vient d'être écrite est la dernière paire.
    const index = (sections.length - 2) >> 1;

    if (index < values.length) {
        // addSection a FUSIONNÉ cette section avec la précédente (règle 4) :
        // il n'y a pas de nouvelle case, il faut recoller les textes aussi.
        values[values.length - 1] = values[values.length - 1].append(value);
    } else {
        // Bourrage jusqu'à l'indice voulu, puis le texte. C'est ce bourrage qui
        // fait que `inserted` est indexé par numéro de section — et qu'on ne
        // bourre pas au-delà du dernier texte réellement inséré.
        while (values.length < index) values.push(Text.empty);
        values.push(value);
    }
}


// Le moteur unique des deux parcours de plages changées.
//
// Il prend un ChangeDesc, mais lit `inserted` — qui n'existe que sur un
// ChangeSet. Sur une description nue, il vaut `undefined` et toutes les plages
// ressortent avec Text.empty. C'est la seule verrue du fichier, et elle est
// telle quelle dans CM6.
function iterChanges(
    desc: ChangeDesc,
    f: (fromA: number, toA: number, fromB: number, toB: number, inserted: Text) => void,
    individual: boolean,
): void {
    const sections = desc.sections;
    const inserted = (desc as ChangeSet).inserted as readonly Text[] | undefined;

    let posA = 0;
    let posB = 0;

    // Début du groupe de sections changées en cours de constitution.
    // -1 = aucun groupe ouvert. C'est la seule mémoire dont on a besoin :
    // la fin du groupe, ce sont les compteurs eux-mêmes.
    let fromA = -1;
    let fromB = -1;

    // Les textes des sections du groupe, recollés au fur et à mesure.
    let texte = Text.empty;

    for (let i = 0 ; i < sections.length ; i += 2) {

        const len = sections[i];
        const ins = sections[i+1]

        if (ins < 0) {
            // Section intacte : rien à émettre, et les deux compteurs
            // avancent du même pas.
            posA += len;
            posB += len;
            continue;
        }

        // Section changée. Si aucun groupe n'est ouvert, celui-ci commence ici.
        if (fromA < 0) {
            fromA = posA;
            fromB = posB;
            texte = Text.empty;
        }

        // Le texte de la paire d'indice i est en inserted[i >> 1]. Deux gardes :
        // `ins` écarte les suppressions pures, la borne écarte la queue non bourrée.
        if (ins && inserted) {
            const k = i >> 1;
            texte = texte.append(k < inserted.length ? inserted[k] : Text.empty);
        }

        posA += len;
        posB += ins;

        // La paire suivante commence en i + 2, donc son `ins` est en i + 3.
        // (Le tableau est de longueur paire : si on est sur la dernière
        // paire, i + 3 déborde et le test est faux.)
        const suivanteChangee =
            i + 3 < sections.length && sections[i + 3] >= 0;

        // On n'émet qu'à la fin du groupe — sauf en mode individual, où
        // chaque section est une plage à elle seule.
        if (individual || !suivanteChangee) {
            f(fromA, posA, fromB, posB, texte);
            fromA = -1;
            fromB = -1;
            texte = Text.empty;
        }
    };
}