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
    }

    // je fais un getter pour être consistant avec CM6
    get lines(): number {
        return(this.text.length);
    }

    toString(): string {
        let output = "";
        for (const [index, line] of this.text.entries()) {
            if (index > 0) {
                output += "\n";
            }
            output += line;
        }
        return(output);
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
    }
}
