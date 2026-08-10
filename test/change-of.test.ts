import { describe, expect, it } from "vitest";
import { ChangeSet } from "../src/state/src/change.ts";
import { Text } from "../src/state/src/text.ts";

/**
 * Bloc B1c — ChangeSet.of : la construction des sections depuis une écriture
 * commode ({from, to?, insert?}), et donc la FORME CANONIQUE.
 *
 * `of` est le seul point du fichier qui fabrique des sections. Tout ce qui est
 * vérifié ici sur la forme est vrai par construction pour toute description
 * produite par la bibliothèque.
 */

const source = "hello world";
const doc = Text.of([source]);

/** Les textes insérés, rendus lisibles. */
function textes(set: ChangeSet): string[] {
    return set.inserted.map((t) => t.toString());
}

describe("ChangeSet.of — les six cas de référence", () => {
    it("cas 1 — insertion en 5", () => {
        const set = ChangeSet.of({ from: 5, to: 5, insert: "XYZ" }, 11);
        expect(set.sections).toEqual([5, -1, 0, 3, 6, -1]);
        expect(textes(set)).toEqual(["", "XYZ"]);
    });

    it("cas 2 — suppression : aucun texte du tout", () => {
        const set = ChangeSet.of({ from: 3, to: 6 }, 11);
        expect(set.sections).toEqual([3, -1, 3, 0, 5, -1]);
        expect(set.inserted).toEqual([]);
    });

    it("cas 3 — deux remplacements disjoints", () => {
        const set = ChangeSet.of(
            [{ from: 1, to: 3, insert: "A" }, { from: 7, to: 9, insert: "BB" }],
            11,
        );
        expect(set.sections).toEqual([1, -1, 2, 1, 4, -1, 2, 2, 2, -1]);
        expect(textes(set)).toEqual(["", "A", "", "BB"]);
    });

    it("cas 4 — une spec qui ne décrit rien laisse le document intact", () => {
        expect(ChangeSet.of([], 11).sections).toEqual([11, -1]);
        expect(ChangeSet.of({ from: 5, to: 5 }, 11).sections).toEqual([11, -1]);
        expect(ChangeSet.of({ from: 5, to: 5, insert: "" }, 11).sections).toEqual([11, -1]);
        expect(ChangeSet.of([], 11).empty).toBe(true);
    });

    it("cas 5 — document vide", () => {
        const set = ChangeSet.of({ from: 0, insert: "abc" }, 0);
        expect(set.sections).toEqual([0, 3]);
        expect(textes(set)).toEqual(["abc"]);
        expect(ChangeSet.of([], 0).sections).toEqual([]);
    });

    it("cas 6 — remplacements adjacents : DEUX sections, pas une", () => {
        const set = ChangeSet.of(
            [{ from: 0, to: 2, insert: "X" }, { from: 2, to: 4, insert: "Y" }],
            11,
        );
        expect(set.sections).toEqual([2, 1, 2, 1, 7, -1]);
        expect(textes(set)).toEqual(["X", "Y"]);
    });
});

describe("ChangeSet.of — l'écriture des specs", () => {
    it("`to` vaut `from` par défaut : une insertion pure", () => {
        expect(ChangeSet.of({ from: 5, insert: "XYZ" }, 11).sections)
            .toEqual([5, -1, 0, 3, 6, -1]);
    });

    it("un insert string multi-ligne est découpé, un Text est pris tel quel", () => {
        const parString = ChangeSet.of({ from: 5, insert: "a\nb" }, 11);
        const parText = ChangeSet.of({ from: 5, insert: Text.of(["a", "b"]) }, 11);
        expect(parString.sections).toEqual(parText.sections);
        expect(textes(parString)).toEqual(textes(parText));
        expect(parString.apply(doc).lines).toBe(2);
    });

    it("les trois conventions de fin de ligne sont reconnues", () => {
        for (const sep of ["\n", "\r\n", "\r"]) {
            const set = ChangeSet.of({ from: 5, insert: `a${sep}b` }, 11);
            expect(set.apply(doc).lines, JSON.stringify(sep)).toBe(2);
        }
    });

    it("les listes imbriquees sont aplaties", () => {
        const plat = ChangeSet.of(
            [{ from: 1, to: 3, insert: "A" }, { from: 7, to: 9, insert: "BB" }],
            11,
        );
        const imbrique = ChangeSet.of(
            [[{ from: 1, to: 3, insert: "A" }], [[{ from: 7, to: 9, insert: "BB" }]]],
            11,
        );
        expect(imbrique.sections).toEqual(plat.sections);
    });
});

describe("ChangeSet.of — la forme canonique", () => {
    it("deux insertions pures au MEME point fusionnent, textes compris", () => {
        // Regle 4 : les longueurs s'additionnent dans la meme section, et
        // addInsert recolle les deux textes au lieu d'ouvrir une case.
        const set = ChangeSet.of(
            [{ from: 5, insert: "a" }, { from: 5, insert: "b" }],
            11,
        );
        expect(set.sections).toEqual([5, -1, 0, 2, 6, -1]);
        expect(textes(set)).toEqual(["", "ab"]);
        expect(set.apply(doc).toString()).toBe("helloab world");
    });

    it("deux suppressions adjacentes fusionnent en une section", () => {
        // Regles 2 et 3 : meme valeur de `ins` (0 ici) donc les `len` s'additionnent.
        const set = ChangeSet.of([{ from: 1, to: 2 }, { from: 2, to: 3 }], 11);
        expect(set.sections).toEqual([1, -1, 2, 0, 8, -1]);
    });

    it("une suppression et une section intacte ne fusionnent JAMAIS", () => {
        // ins === 0 et ins === -1 sont deux valeurs differentes : la sentinelle
        // fait tout le travail.
        expect(ChangeSet.of({ from: 0, to: 3 }, 11).sections).toEqual([3, 0, 8, -1]);
    });

    it("aucune section ne consomme 0 et n'insere 0", () => {
        const sets = [
            ChangeSet.of([], 11),
            ChangeSet.of({ from: 0, to: 11, insert: "X" }, 11),
            ChangeSet.of([{ from: 0, insert: "a" }, { from: 11, insert: "b" }], 11),
            ChangeSet.of({ from: 0, to: 11 }, 11),
        ];
        for (const set of sets) {
            for (let i = 0; i < set.sections.length; i += 2) {
                expect(set.sections[i] === 0 && set.sections[i + 1] <= 0).toBe(false);
            }
        }
    });

    it("la couverture est toujours totale : somme(len) === length", () => {
        const specs: [number, number, string][] = [
            [0, 0, "X"], [0, 11, ""], [3, 6, "abc"], [11, 11, "fin"], [0, 11, "tout"],
        ];
        for (const [from, to, insert] of specs) {
            expect(ChangeSet.of({ from, to, insert }, 11).length).toBe(11);
        }
    });
});

describe("ChangeSet.of — bornes et restriction du bloc B", () => {
    it("leve sur une plage invalide", () => {
        expect(() => ChangeSet.of({ from: 6, to: 3 }, 11)).toThrow(RangeError);
        expect(() => ChangeSet.of({ from: -1, to: 3 }, 11)).toThrow(RangeError);
        expect(() => ChangeSet.of({ from: 3, to: 12 }, 11)).toThrow(RangeError);
    });

    it("leve sur des changements non tries ou chevauchants", () => {
        // Simplification assumee : CM6 les compose entre eux, nous pas encore.
        // La levee disparaitra au bloc C, quand compose et map existeront.
        expect(() => ChangeSet.of([{ from: 7, to: 9 }, { from: 1, to: 3 }], 11))
            .toThrow(RangeError);
        expect(() => ChangeSet.of([{ from: 1, to: 5 }, { from: 3, to: 7 }], 11))
            .toThrow(RangeError);
    });

    it("des changements qui se touchent sont acceptes", () => {
        expect(() => ChangeSet.of([{ from: 1, to: 3 }, { from: 3, to: 5 }], 11))
            .not.toThrow();
    });
});

describe("ChangeSet.of + apply — oracle exhaustif", () => {
    for (const insert of ["", "X", "XY", "a\nb"]) {
        it(`insert ${JSON.stringify(insert)} sur les 78 paires [from, to)`, () => {
            for (let from = 0; from <= source.length; from++) {
                for (let to = from; to <= source.length; to++) {
                    const set = ChangeSet.of({ from, to, insert }, source.length);
                    const attendu = source.slice(0, from) + insert + source.slice(to);
                    expect(set.length, `${from}..${to}`).toBe(source.length);
                    expect(set.newLength, `${from}..${to}`).toBe(attendu.length);
                    expect(set.apply(doc).toString(), `${from}..${to}`).toBe(attendu);
                }
            }
        });
    }

    it("deux changements disjoints, toutes les combinaisons", () => {
        for (let a = 0; a <= 4; a++) {
            for (let b = a; b <= 5; b++) {
                for (let c = b; c <= 8; c++) {
                    for (let d = c; d <= source.length; d++) {
                        const set = ChangeSet.of(
                            [
                                { from: a, to: b, insert: "1" },
                                { from: c, to: d, insert: "22" },
                            ],
                            source.length,
                        );
                        const attendu =
                            source.slice(0, a) + "1" + source.slice(b, c) + "22" +
                            source.slice(d);
                        expect(set.apply(doc).toString(), `${a},${b},${c},${d}`)
                            .toBe(attendu);
                        expect(set.newLength).toBe(attendu.length);
                    }
                }
            }
        }
    });
});
