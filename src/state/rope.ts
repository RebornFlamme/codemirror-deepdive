// Je définis les noeuds et les feuilles de l'abre du document
// Important : tout est immuable -> d'où l'apprentissage du readonly intensif

export abstract class Text {
    // le nombre de lignes
    abstract readonly lines: number;
    // le nombre de caractères \n compris
    abstract readonly length: number;
    // le tableau des enfants dans le cas d'un noeud
    abstract readonly children: readonly Text[] | null;

    abstract toString(): string
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
}
