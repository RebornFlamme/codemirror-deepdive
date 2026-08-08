// Je définis les noeuds et les feuilles de l'abre du document
// Important : tout est immuable -> d'où l'apprentissage du readonly intensif
// l'idée de lineAt almost oneshot c'est cool ! => bien penser à cette descente d'information

export type Line = {
    // offset de début de la ligne
    from: number,
    // offset de fin
    to: number,
    // numéro de la ligne
    number: number,
    // le texte
    text: string,

    get length(): number
}

// Enum qui permet de savoir si l'intervalle est ouvert ou fermé. 
// cela permet de savoir s'il faut faire des sauts de lignes
// pour le comprendre il faut le regarder en binaire
// Open.from = 1 -> 01
// Open.to = 2 -> 10
// => ça ne se chevauche pas

// Open.From => from est ouvert
// Open.To => To est ouvert

const enum Open {
    From = 1,
    To = 2
}

export abstract class Text {
    // le nombre de lignes
    abstract readonly lines: number;
    // le nombre de caractères \n compris
    abstract readonly length: number;
    // le tableau des enfants dans le cas d'un noeud
    abstract readonly children: readonly Text[] | null;

    // retourne le string a la ligne précise
    abstract toString(): string;
    
    // La fonction suivante appelle le type Line
    // Renvoie la ligne à laquelle appartient le caractère à la position offset
    abstract lineAt(offset: number): Line;
    // Renvoie la ligne numero n
    abstract line(n: number): Line;

    // Le moteur commun de lineAt / line : une seule descente dans l'arbre.
    // Doit être déclarée ici pour que TextNode puisse appeler child.lineInner().
    abstract lineInner(
        target: number, // offset OU numéro de ligne recherché
        isLine: boolean, // true => target est un numéro de ligne
        // Repère du nœud courant, accumulé pendant la descente :
        line: number, // nb de lignes situées AVANT ce nœud
        offset: number // offset du 1er caractère de ce nœud
    ): Line;

    // extrait le texte entre from et to et l'empile dans target
    // un enum c'est juste un number déguisé
    // et on utilise l'opératueur | qui est une porte OU bit à bit en JS
    abstract decompose(from: number, to: number, target: Text[], open: Open): void;

    // Le texte de l'intervalle [from, to), comme document autonome.
    // Contrairement à line/lineAt qui lèvent, slice RECADRE silencieusement :
    // ses bornes peuvent venir d'un calcul périmé (convention CM6).
    slice(from: number, to: number = this.length): Text {
        [from, to] = clip(this, from, to);

        const target: Text[] = [];
        // 0 : les deux bords fermés — un slice ne se soude à rien.
        // Le `as Open` est nécessaire, TS n'accepte pas un littéral hors des
        // membres déclarés de l'enum.
        this.decompose(from, to, target, 0 as Open);

        // decompose empile PLUSIEURS morceaux : il faut les assembler, pas
        // prendre le premier.
        return TextNode.from(target);
    }

    // Remplace [from, to) par `text`. Rend un NOUVEAU document, this est intact.
    replace(from: number, to: number, text: Text): Text {
        // Bien comprendre pourquoi on ouvre tout
        
        // from et to sont des positions dans CE document, pas dans l'insertion.
        [from, to] = clip(this, from, to);

        const parts: Text[] = [];

        // Les trois morceaux atterrissent dans le MÊME parts : les soudures se
        // font au fur et à mesure, chaque appel trouvant le précédent déjà empilé.
        //
        // Seuls les bords extérieurs restent fermés (le début du préfixe et la
        // fin du suffixe) : ce sont les vraies extrémités du document. Les deux
        // jointures internes sont ouvertes des deux côtés.

        // Préfixe : son bord droit n'est pas une fin de ligne, l'insertion le prolonge.
        this.decompose(0, from, parts, Open.To); // le To de l'intervalle est ouvert

        // Insertion : elle prolonge le préfixe ET est prolongée par le suffixe.
        // Le garde évite le cas dégénéré d'une feuille sans aucune ligne, dont
        // la soudure lirait un text[0] inexistant.
        if (text.length) text.decompose(0, text.length, parts, Open.From | Open.To);

        // Suffixe : son bord gauche prolonge ce qui précède.
        this.decompose(to, this.length, parts, Open.From); // le from est ouvert

        return TextNode.from(parts);
    }

    // Concaténation : un remplacement de l'intervalle vide en fin de document.
    append(other: Text): Text {
        return this.replace(this.length, this.length, other);
    }
}

// Recadre un intervalle sur les bornes du document.
// L'ordre compte : `to` est borné par le bas avec le `from` DÉJÀ recadré, ce qui
// transforme un intervalle inversé en intervalle vide plutôt qu'en erreur.
function clip(text: Text, from: number, to: number): [number, number] {
    from = Math.max(0, Math.min(text.length, from));
    return [from, Math.max(from, Math.min(text.length, to))];
}

export class TextNode extends Text {
    
    readonly lines: number = 0;
    readonly length: number = 0;
    readonly children: readonly Text[];

    constructor(children: readonly Text[]) {
        super();
        // init des enfants
        this.children = children;
        // init du nombre de lignes
        for (const child of this.children) {
            this.lines += child.lines;
            this.length += child.length;
        }
        this.length += children.length - 1;

    }

    toString(): string {
        return this.children.map(node => node.toString()).join("\n");
    }

    lineAt(target: number): Line {
        if (target < 0 || target > this.length) {
            throw new RangeError(`offset ${target} is not in the document`)
        }
        return this.lineInner(target, false, 0, 0);
    }

    line(n: number): Line {
        if (n < 1 || n > this.lines) {
            throw new RangeError(`line number ${n} is not in the document`)
        };
        return this.lineInner(n, true, 0, 0);
    }

    lineInner(
        target: number, // offset / numéro de ligne recherché
        isLine: boolean, // est-ce que target est un numéro de ligne ou un offset
        // ici ce sont les lignes et les offsets accumulées pendant la descente
        line: number, // nb de lignes accumulées
        offset: number // offset accumulé
    ): Line {
        // Décalages accumulés par les enfants DÉJÀ traversés, relatifs au nœud.
        let cumLength = 0;
        let cumLines = 0;

        for (const child of this.children) {
            // Dernière position couverte par cet enfant, dans le repère absolu.
            // - en mode ligne : son numéro de dernière ligne
            // - en mode offset : l'offset de son dernier caractère
            // On a bien décalé par line et offset
            const end = isLine
                ? line + cumLines + child.lines
                : offset + cumLength + child.length;

            // On descend dans le premier enfant qui contient la cible, en lui
            // transmettant son propre repère absolu (c'est la "descente
            // d'information" : l'enfant n'a jamais à remonter pour se situer).
            if (target <= end) {
                return child.lineInner(
                    target,
                    isLine,
                    line + cumLines,
                    offset + cumLength,
                );
            }

            // +1 pour le \n de jonction inséré entre deux enfants
            cumLength += child.length + 1; // on oublie par que le \n compte
            cumLines += child.lines;
        }

        // Inatteignable si lineAt/line ont validé target et si les métriques
        // en cache sont cohérentes.
        throw new RangeError(`${isLine ? "line" : "offset"} ${target} is not in the document`);
    }

    decompose(from: number, to: number, target: Text[], open: Open): void {
        // pos = offset du premier caractère de l'enfant courant, dans le repère
        // de CE nœud (from/to sont déjà exprimés dans ce repère).
        let pos = 0;

        for (const child of this.children) {
            const end = pos + child.length;

            // On regarde si ça intersecte l'interval
            if (from <= end && to >= pos) {
                // Deux étapes en une expression.
                //
                // 1. Le masque : quels bords de l'intervalle tombent DANS cet
                //    enfant ? On est déjà dans le `if` d'intersection, donc
                //    `pos <= from` équivaut à `from ∈ [pos, end]`, et
                //    `end >= to` à `to ∈ [pos, end]`. Un enfant strictement
                //    intérieur n'en porte aucun et ressort à 0.
                //
                // 2. Le `& open` : un bord ne compte que s'il est touché ET
                //    ouvert. Sans ce filtre on ouvrirait de vraies frontières de
                //    ligne et on souderait des morceaux devant rester séparés.
                const childOpen = open & (
                    (pos <= from ? Open.From : 0) |
                    (end >= to ? Open.To : 0)
                );

                if (pos >= from && end <= to && !childOpen) {
                    // Entièrement contenu et aucun bord ouvert : on partage le
                    // sous-arbre tel quel, sans descendre ni rien recopier.
                    // C'est le seul endroit qui rend decompose sous-linéaire.
                    target.push(child);
                } else {
                    // Sinon on descend, en traduisant l'intervalle dans le repère
                    // de l'enfant. Le bit To empêche le raccourci ci-dessus au
                    // bord droit, ce qui garantit que le prochain morceau soudé
                    // trouvera bien une feuille à dépiler.
                    child.decompose(from - pos, to - pos, target, childOpen);
                }
            }

            // +1 pour le \n de jonction entre deux enfants
            pos = end + 1;
        }
    }

    static from(children: Text[], length?: number): Text {
        // length dans CM6 on a dans le constructeur un paramètre length 
        // poru éviter le calcul nous on ne l'a pas dans la verison naive OK
        if (children.length === 1) {
            return(children[0]);
        };
        return(new TextNode(children));
    }
}

export class TextLeaf extends Text {

    readonly length: number = 0;
    readonly text: readonly string[];
    readonly children = null;

    constructor(text: readonly string[]) {
        super();
        this.text = text;
        for (const line of text) {
            this.length += line.length;
        }
        // on intègre les \n
        // hedge case faut que ça retourne 0 pour un tableau vide et pas -1
        if (this.text.length !== 0) {
            this.length += text.length - 1;
        }
    };

    // je fais un getter pour être consistant avec CM6
    get lines(): number {
        return(this.text.length);
    };

    toString(): string {
        let output = "";
        for (const [index, line] of this.text.entries()) {
            if (index > 0) {
                output += "\n";
            }
            output += line;
        }
        return(output);
    };

    lineAt(target: number): Line {
        if (target < 0 || target > this.length) {
            throw new RangeError(`offset ${target} is not in the document`)
        }
        return this.lineInner(target, false, 0, 0);
    };

    line(n: number): Line {
        if (n < 1 || n > this.lines) {
            throw new RangeError(`line number ${n} is not in the document`)
        };
        return this.lineInner(n, true, 0, 0);
    };


    lineInner(
        target: number, // offset / numéro de ligne recherché
        isLine: boolean, // est-ce que target est un numéro de ligne ou un offset
        // ici ce sont les lignes et les offsets accumulées pendant la descente
        line: number, // nb de lignes accumulées
        offset: number // offset accumulé
    ): Line {
        // Décalage accumulé par les lignes déjà parcourues, relatif à la feuille.
        let cumLength = 0;

        // NB : la variable de boucle ne s'appelle PAS `line`, sinon elle masque
        // le paramètre qui porte le décalage de numérotation.
        for (const [index, text] of this.text.entries()) {
            // Repère absolu de la ligne : on ajoute le décalage reçu du parent.
            const from = offset + cumLength;
            const to = from + text.length;
            const number = line + index + 1;

            // En mode offset, `to` est la position du \n qui suit la ligne :
            // `target <= to` rattache donc ce \n à la ligne qu'il termine.
            if (isLine ? target <= number : target <= to) {
                return {
                    from,
                    to,
                    number,
                    text,

                    get length() {
                        return to - from;
                    }
                }
            }

            // +1 pour le \n séparant cette ligne de la suivante
            cumLength += text.length + 1;
        };

        throw new RangeError(`${isLine ? "line" : "offset"} ${target} is not in the document`);
    };

    // Mon premier essai cruellement pas élégant
    // decompose(from: number, to: number, target: Text[], open: Open): void {
        
    //     // ne pas oublier \n qui fait un +1 
        
    //     if (from <= 0 && to >= this.length) {
    //         target.push(this);
    //         return;
    //     };

    //     const text = [];
    //     let cumLength = 0;

    //     for (const line of this.text) {

    //         if (cumLength + line.length <= from) {
    //             cumLength += line.length + 1;
    //             continue
    //         }

    //         // Le premier bout de texte 
    //         if (cumLength + line.length > from && text.length === 0) {
    //             text.push(line.slice(from - cumLength, to - cumLength));
    //             continue
    //         }

    //         // le dernier bout de texte
    //         if (to <= cumLength + line.length) {
    //             // ici on peut mettre 0, si le [from, to] avait été contenu dans une seule ligne
    //             // il aurait été catch au-desssus
    //             text.push(line.slice(0, to - cumLength));
    //             break
    //         }

    //         // tous les bout de texte du milieu
    //         text.push(line);
    //         cumLength += line.length + 1;
    //     };

    //     target.push(new TextLeaf(text));
    //     return;
    // };

    decompose(from: number, to: number, target: Text[], open: Open): void {
        // Deux questions distinctes : QUEL est le morceau, puis COMMENT on le pose.
        // Le raccourci ne répond qu'à la première — pas de return, pas de push ici,
        // sinon la soudure est sautée (c'est le cas du suffixe dans replace).
        let piece: TextLeaf;

        if (from <= 0 && to >= this.length) {
            // L'intervalle couvre toute la feuille : on la partage telle quelle.
            piece = this;
        } else {
            const lines: string[] = [];
            let cumLength = 0;

            for (const line of this.text) {
                const lineFrom = cumLength;
                const lineTo = lineFrom + line.length;

                // cumLength avance pour TOUTES les lignes : c'est le compteur de
                // position, il ne dépend pas de ce qu'on décide de garder.
                // +1 pour le \n qui suit la ligne.
                cumLength += line.length + 1;

                // Bornes larges des deux côtés : une ligne qui ne touche
                // l'intervalle que par son extrémité compte quand même, sinon
                // decompose(3, 4) perdrait une des deux lignes vides de "\n".
                if (lineTo < from || to < lineFrom) continue;

                // Une seule expression pour les quatre situations (première ligne,
                // milieu, dernière, ligne unique contenant tout l'intervalle) :
                // l'intervalle ramené dans le repère de la ligne, puis recadré
                // sur la ligne. Sur une ligne du milieu, les deux bornes sont
                // neutralisées et on récupère la ligne entière.
                lines.push(line.slice(
                    Math.max(0, from - lineFrom),
                    Math.min(to - lineFrom, line.length),
                ));
            }

            piece = new TextLeaf(lines);
        }

        if (open & Open.From) {
            // Le bit From dit que ce morceau prolonge le précédent : sa première
            // ligne et la dernière du précédent n'en forment plus qu'une.
            const prev = target.pop();
            if (!(prev instanceof TextLeaf)) {
                // Invariant garanti par l'appelant — côté TextNode c'est le rôle
                // du bit To. On lève plutôt que de souder dans le vide.
                throw new Error("Open.From exige une feuille à souder dans target");
            }

            const last = prev.text.length - 1;
            const fused = prev.text.slice(0, last)
                .concat(prev.text[last] + piece.text[0])
                .concat(piece.text.slice(1));

            target.push(new TextLeaf(fused));
        } else {
            target.push(piece);
        }
    }
}
