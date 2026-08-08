import { describe, expect, it } from "vitest";
import { Text, TextLeaf, TextNode } from "../src/state/src/text.ts";

/**
 * Invariant central du rope : les métriques mises en cache doivent toujours
 * décrire exactement le texte que le nœud représente.
 *
 * C'est ce qui casse en premier quand la comptabilité des "\n" est fausse,
 * donc on le vérifie sur chaque nœud construit dans les tests.
 */
function expectConsistent(node: Text): void {
    const text = node.toString();
    expect(node.length, `length doit valoir toString().length`).toBe(text.length);
    expect(node.lines, `lines doit valoir le nombre de lignes`).toBe(
        text.split("\n").length,
    );
}

describe("TextLeaf", () => {
    it("expose les lignes qu'on lui a passées", () => {
        const leaf = new TextLeaf(["const a = 1", "const b = 2"]);
        expect(leaf.text).toEqual(["const a = 1", "const b = 2"]);
    });

    it("compte une ligne par entrée du tableau", () => {
        expect(new TextLeaf(["a"]).lines).toBe(1);
        expect(new TextLeaf(["a", "b"]).lines).toBe(2);
        expect(new TextLeaf(["a", "b", "c"]).lines).toBe(3);
    });

    it("compte les \\n séparateurs dans length", () => {
        // "a\nb" = 3 caractères, pas 2
        const leaf = new TextLeaf(["a", "b"]);
        expect(leaf.length).toBe(3);
        expectConsistent(leaf);
    });

    it("n'ajoute pas de \\n sur une ligne unique", () => {
        const leaf = new TextLeaf(["abc"]);
        expect(leaf.length).toBe(3);
        expectConsistent(leaf);
    });

    it("gère les lignes vides", () => {
        // "a\n\nb" : la ligne du milieu est vide mais compte
        const leaf = new TextLeaf(["a", "", "b"]);
        expect(leaf.lines).toBe(3);
        expect(leaf.length).toBe(4);
        expectConsistent(leaf);
    });

    it("représente un document vide comme une ligne vide", () => {
        const leaf = new TextLeaf([""]);
        expect(leaf.lines).toBe(1);
        expect(leaf.length).toBe(0);
        expect(leaf.toString()).toBe("");
        expectConsistent(leaf);
    });

    describe("toString", () => {
        it("joint les lignes avec \\n", () => {
            expect(new TextLeaf(["a", "b", "c"]).toString()).toBe("a\nb\nc");
        });

        it("n'ajoute pas de \\n final", () => {
            expect(new TextLeaf(["a", "b"]).toString()).toBe("a\nb");
        });

        it("préserve un \\n final explicite via une dernière ligne vide", () => {
            // ["a", ""] et ["a"] doivent rester distincts
            expect(new TextLeaf(["a", ""]).toString()).toBe("a\n");
            expect(new TextLeaf(["a"]).toString()).toBe("a");
        });

        it("est réversible avec split", () => {
            const lines = ["import x", "", "export const y = 1", ""];
            expect(new TextLeaf(lines).toString().split("\n")).toEqual(lines);
        });
    });
});

describe("TextNode", () => {
    it("somme les lignes de ses enfants", () => {
        const node = new TextNode([
            new TextLeaf(["a", "b"]),
            new TextLeaf(["c"]),
        ]);
        expect(node.lines).toBe(3);
    });

    it("somme les longueurs de ses enfants plus les \\n de jonction", () => {
        // "a\nb" (3) + "\n" (1) + "c" (1) = 5
        const node = new TextNode([
            new TextLeaf(["a", "b"]),
            new TextLeaf(["c"]),
        ]);
        expect(node.length).toBe(5);
        expectConsistent(node);
    });

    it("joint ses enfants avec \\n", () => {
        const node = new TextNode([
            new TextLeaf(["a", "b"]),
            new TextLeaf(["c"]),
        ]);
        expect(node.toString()).toBe("a\nb\nc");
    });

    it("accepte plus de deux enfants", () => {
        const node = new TextNode([
            new TextLeaf(["a"]),
            new TextLeaf(["b"]),
            new TextLeaf(["c"]),
        ]);
        expect(node.toString()).toBe("a\nb\nc");
        expect(node.lines).toBe(3);
        expectConsistent(node);
    });

    it("compose des nœuds imbriqués", () => {
        const inner = new TextNode([new TextLeaf(["a"]), new TextLeaf(["b"])]);
        const outer = new TextNode([inner, new TextLeaf(["c", "d"])]);

        expect(outer.toString()).toBe("a\nb\nc\nd");
        expect(outer.lines).toBe(4);
        expect(outer.length).toBe(7);
        expectConsistent(outer);
    });

    it("donne les mêmes métriques quelle que soit la forme de l'arbre", () => {
        // Deux arbres différents représentant "a\nb\nc\nd"
        const gauche = new TextNode([
            new TextNode([new TextLeaf(["a"]), new TextLeaf(["b"])]),
            new TextNode([new TextLeaf(["c"]), new TextLeaf(["d"])]),
        ]);
        const plat = new TextNode([new TextLeaf(["a", "b", "c", "d"])]);

        expect(gauche.toString()).toBe(plat.toString());
        expect(gauche.lines).toBe(plat.lines);
        expect(gauche.length).toBe(plat.length);
    });

    it("propage les lignes vides à travers l'arbre", () => {
        const node = new TextNode([
            new TextLeaf(["a", ""]),
            new TextLeaf(["", "b"]),
        ]);
        expect(node.toString()).toBe("a\n\n\nb");
        expect(node.lines).toBe(4);
        expectConsistent(node);
    });

    it("calcule ses métriques à la construction, pas à la lecture", () => {
        // Deux lectures successives doivent renvoyer la même valeur sans
        // re-parcourir l'arbre : on vérifie au moins la stabilité.
        const node = new TextNode([new TextLeaf(["a", "b"])]);
        expect(node.lines).toBe(node.lines);
        expect(node.length).toBe(node.length);
    });
});
