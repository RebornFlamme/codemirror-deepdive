import { describe, expect, it } from "vitest";
import { ChangeDesc, ChangeSet } from "../src/state/src/change.ts";
import { Text } from "../src/state/src/text.ts";

/**
 * Bloc C1 — inverser.
 *
 * `invertedDesc` inverse la GÉOMÉTRIE : len et ins échangent leur rôle.
 * `invert(doc)` a besoin du document d'AVANT, parce que la description sait
 * qu'elle a supprimé n caractères mais pas lesquels.
 *
 * L'inverse s'applique au document PRODUIT par le changement.
 */

const source = "hello world";
const doc = Text.of([source]);

const references: [string, number[], number[]][] = [
    ["1 — insertion devient suppression", [5, -1, 0, 3, 6, -1], [5, -1, 3, 0, 6, -1]],
    ["2 — suppression devient insertion", [3, -1, 3, 0, 5, -1], [3, -1, 0, 3, 5, -1]],
    [
        "3 — deux remplacements",
        [1, -1, 2, 1, 4, -1, 2, 2, 2, -1],
        [1, -1, 1, 2, 4, -1, 2, 2, 2, -1],
    ],
    ["4 — aucun changement est son propre inverse", [11, -1], [11, -1]],
    ["5 — insertion dans le vide", [0, 3], [3, 0]],
    ["6 — adjacents : les deux sections restent", [2, 1, 2, 1, 7, -1], [1, 2, 1, 2, 7, -1]],
    ["7 — description vide", [], []],
];

describe("ChangeDesc.invertedDesc — la géométrie inverse", () => {
    for (const [nom, sections, attendu] of references) {
        it(nom, () => {
            expect(new ChangeDesc(sections).invertedDesc.sections).toEqual(attendu);
        });
    }

    it("length et newLength s'échangent", () => {
        for (const [, sections] of references) {
            const desc = new ChangeDesc(sections);
            expect(desc.invertedDesc.length).toBe(desc.newLength);
            expect(desc.invertedDesc.newLength).toBe(desc.length);
        }
    });

    it("est une involution", () => {
        for (const [, sections] of references) {
            const desc = new ChangeDesc(sections);
            expect(desc.invertedDesc.invertedDesc.sections).toEqual(desc.sections);
        }
    });

    it("préserve la forme canonique", () => {
        // L'échange ne peut pas produire une section qui ne décrit rien, ni
        // deux sections fusionnables : la forme canonique est stable.
        for (const [, sections] of references) {
            const inverse = new ChangeDesc(sections).invertedDesc.sections;
            for (let i = 0; i < inverse.length; i += 2) {
                expect(inverse[i] === 0 && inverse[i + 1] <= 0).toBe(false);
            }
        }
    });
});

describe("ChangeSet.invert — l'exemple complet", () => {
    it("un remplacement : les caractères supprimés sont relus dans doc", () => {
        const set = ChangeSet.of({ from: 5, to: 10, insert: "AB" }, 11);
        expect(set.sections).toEqual([5, -1, 5, 2, 1, -1]);
        expect(set.apply(doc).toString()).toBe("helloABd");

        const inverse = set.invert(doc);
        expect(inverse.sections).toEqual([5, -1, 2, 5, 1, -1]);
        expect(inverse.inserted.map((t) => t.toString())).toEqual(["", " worl"]);
        expect(inverse.length).toBe(set.newLength);
        expect(inverse.newLength).toBe(set.length);
        expect(inverse.apply(set.apply(doc)).toString()).toBe(source);
    });

    it("une insertion pure : son inverse n'a rien à réinsérer", () => {
        const set = ChangeSet.of({ from: 5, insert: "XYZ" }, 11);
        const inverse = set.invert(doc);
        expect(inverse.sections).toEqual([5, -1, 3, 0, 6, -1]);
        expect(inverse.inserted.map((t) => t.toString())).toEqual(["", ""]);
    });

    it("une suppression pure : son inverse porte tout le texte perdu", () => {
        const set = ChangeSet.of({ from: 3, to: 6 }, 11);
        const inverse = set.invert(doc);
        expect(inverse.sections).toEqual([3, -1, 0, 3, 5, -1]);
        expect(inverse.inserted.map((t) => t.toString())).toEqual(["", "lo "]);
    });

    it("ne rien changer est son propre inverse", () => {
        const rien = ChangeSet.empty(11);
        expect(rien.invert(doc).sections).toEqual([11, -1]);
        expect(rien.invert(doc).apply(doc).toString()).toBe(source);
    });

    it("le compteur de position avance aussi sur les sections intactes", () => {
        // Si `pos` n'avançait que sur les sections changées, le second texte
        // relu serait pris au mauvais endroit.
        const set = ChangeSet.of(
            [{ from: 1, to: 3, insert: "A" }, { from: 7, to: 9, insert: "BB" }],
            11,
        );
        const inverse = set.invert(doc);
        expect(inverse.inserted.map((t) => t.toString())).toEqual(["", "el", "", "or"]);
    });
});

describe("ChangeSet.invert — l'aller-retour", () => {
    for (const insert of ["", "X", "XY", "a\nb"]) {
        it(`insert ${JSON.stringify(insert)} : invert(doc).apply(apply(doc)) === doc`, () => {
            for (let from = 0; from <= source.length; from++) {
                for (let to = from; to <= source.length; to++) {
                    const set = ChangeSet.of({ from, to, insert }, source.length);
                    const apres = set.apply(doc);
                    const inverse = set.invert(doc);

                    expect(inverse.length, `${from}..${to}`).toBe(apres.length);
                    expect(inverse.apply(apres).toString(), `${from}..${to}`).toBe(source);
                }
            }
        });
    }

    it("inverser deux fois redonne le changement de départ", () => {
        for (let from = 0; from <= source.length; from++) {
            for (let to = from; to <= source.length; to++) {
                const set = ChangeSet.of({ from, to, insert: "AB" }, source.length);
                const doubleInverse = set.invert(doc).invert(set.apply(doc));

                expect(doubleInverse.sections, `${from}..${to}`).toEqual(set.sections);
                expect(doubleInverse.apply(doc).toString(), `${from}..${to}`)
                    .toBe(set.apply(doc).toString());
            }
        }
    });

    it("l'aller-retour marche aussi sur plusieurs changements", () => {
        const set = ChangeSet.of(
            [
                { from: 0, to: 2, insert: "Z" },
                { from: 4, to: 4, insert: "\n" },
                { from: 7, to: 11, insert: "" },
            ],
            11,
        );
        const apres = set.apply(doc);
        expect(set.invert(doc).apply(apres).toString()).toBe(source);
    });
});
