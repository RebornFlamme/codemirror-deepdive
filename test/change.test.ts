import { describe, expect, it } from "vitest";
import { ChangeDesc, ChangeSet } from "../src/state/src/change.ts";
import { Text } from "../src/state/src/text.ts";

/**
 * Bloc B1a — la géométrie d'un changement, sans le texte inséré.
 *
 * Toutes les descriptions ci-dessous portent sur le document "hello world"
 * (longueur 11), sauf le cas 5 qui part du document vide.
 *
 * Rappel de l'encodage : le tableau se lit par paires (len, ins).
 *   len = caractères consommés dans l'ANCIEN document
 *   ins = -1 si la section est intacte, sinon longueur du remplacement
 * L'invariant central est la COUVERTURE TOTALE : somme(len) == length.
 */

type Cas = {
    nom: string;
    sections: number[];
    length: number;
    newLength: number;
    empty: boolean;
    toString: string;
};

const cas: Cas[] = [
    {
        nom: "1 — insérer \"XYZ\" en 5",
        sections: [5, -1, 0, 3, 6, -1],
        length: 11,
        newLength: 14,
        empty: false,
        toString: "5 0:3 6",
    },
    {
        nom: "2 — supprimer [3, 6)",
        sections: [3, -1, 3, 0, 5, -1],
        length: 11,
        newLength: 8,
        empty: false,
        toString: "3 3:0 5",
    },
    {
        nom: "3 — [1,3) → \"A\" et [7,9) → \"BB\"",
        sections: [1, -1, 2, 1, 4, -1, 2, 2, 2, -1],
        length: 11,
        newLength: 10,
        empty: false,
        toString: "1 2:1 4 2:2 2",
    },
    {
        nom: "4 — aucun changement",
        sections: [11, -1],
        length: 11,
        newLength: 11,
        empty: true,
        toString: "11",
    },
    {
        nom: "5 — document vide, insérer \"abc\"",
        sections: [0, 3],
        length: 0,
        newLength: 3,
        empty: false,
        toString: "0:3",
    },
    {
        nom: "6 — [0,2) → \"X\" et [2,4) → \"Y\" (changements adjacents)",
        sections: [2, 1, 2, 1, 7, -1],
        length: 11,
        newLength: 9,
        empty: false,
        toString: "2:1 2:1 7",
    },
    {
        nom: "7 — document vide, aucun changement",
        sections: [],
        length: 0,
        newLength: 0,
        empty: true,
        toString: "",
    },
];

describe("ChangeDesc — métriques", () => {
    for (const c of cas) {
        describe(c.nom, () => {
            const desc = new ChangeDesc(c.sections);

            it("se lit par paires", () => {
                expect(c.sections.length % 2).toBe(0);
            });

            it(`length vaut ${c.length} (longueur AVANT)`, () => {
                expect(desc.length).toBe(c.length);
            });

            it(`newLength vaut ${c.newLength} (longueur APRÈS)`, () => {
                expect(desc.newLength).toBe(c.newLength);
            });

            it(`empty vaut ${c.empty}`, () => {
                expect(desc.empty).toBe(c.empty);
            });

            it(`toString() vaut "${c.toString}"`, () => {
                expect(String(desc)).toBe(c.toString);
            });
        });
    }
});

describe("ChangeDesc — invariants", () => {
    it("length est la somme des len, quelle que soit la description", () => {
        for (const c of cas) {
            const attendu = c.sections
                .filter((_, i) => i % 2 === 0)
                .reduce((a, b) => a + b, 0);
            expect(new ChangeDesc(c.sections).length).toBe(attendu);
        }
    });

    it("une section intacte contribue sa longueur des DEUX côtés", () => {
        // Le piège de newLength : sommer les ins donnerait -1 pour une section
        // intacte. Ici les deux longueurs doivent coïncider.
        const intact = new ChangeDesc([7, -1]);
        expect(intact.length).toBe(7);
        expect(intact.newLength).toBe(7);
    });

    it("supprimer tout n'est PAS empty, contrairement à ne rien changer", () => {
        expect(new ChangeDesc([11, -1]).empty).toBe(true);
        expect(new ChangeDesc([11, 0]).empty).toBe(false);
    });

    it("empty exige une SEULE section intacte, pas deux", () => {
        // Deux sections intactes adjacentes ne devraient jamais coexister
        // (la forme canonique les fusionne), mais empty ne doit pas mentir
        // si ça arrive : il teste la forme, pas le sens.
        expect(new ChangeDesc([5, -1, 6, -1]).empty).toBe(false);
    });
});

/** Collecte les appels d'iterGaps sous forme de triplets. */
function gapsOf(desc: ChangeDesc): number[][] {
    const gaps: number[][] = [];
    desc.iterGaps((posA, posB, length) => gaps.push([posA, posB, length]));
    return gaps;
}

describe("ChangeDesc.iterGaps — les parties intactes", () => {
    const attendus: [string, number[], number[][]][] = [
        ["1 — insertion en 5", [5, -1, 0, 3, 6, -1], [[0, 0, 5], [5, 8, 6]]],
        ["2 — suppression [3,6)", [3, -1, 3, 0, 5, -1], [[0, 0, 3], [6, 3, 5]]],
        [
            "3 — deux remplacements",
            [1, -1, 2, 1, 4, -1, 2, 2, 2, -1],
            [[0, 0, 1], [3, 2, 4], [9, 8, 2]],
        ],
        ["4 — aucun changement : un seul trou, tout le doc", [11, -1], [[0, 0, 11]]],
        ["5 — insertion dans le doc vide : aucun trou", [0, 3], []],
        ["6 — changements adjacents", [2, 1, 2, 1, 7, -1], [[4, 2, 7]]],
        ["7 — description vide : aucun trou", [], []],
    ];

    for (const [nom, sections, attendu] of attendus) {
        it(nom, () => {
            expect(gapsOf(new ChangeDesc(sections))).toEqual(attendu);
        });
    }

    it("les trous sortent en ordre croissant et ne se recouvrent pas", () => {
        for (const [, sections] of attendus) {
            let finA = -1;
            let finB = -1;
            for (const [posA, posB, length] of gapsOf(new ChangeDesc(sections))) {
                expect(posA).toBeGreaterThanOrEqual(finA);
                expect(posB).toBeGreaterThanOrEqual(finB);
                finA = posA + length;
                finB = posB + length;
            }
        }
    });

    it("un trou décrit le MÊME texte des deux côtés", () => {
        // "hello world", insertion de "XYZ" en 5 → "helloXYZ world".
        // Chaque trou doit désigner la même sous-chaîne dans les deux docs.
        const avant = "hello world";
        const apres = "helloXYZ world";
        for (const [posA, posB, length] of gapsOf(new ChangeDesc([5, -1, 0, 3, 6, -1]))) {
            expect(apres.slice(posB, posB + length)).toBe(
                avant.slice(posA, posA + length),
            );
        }
    });
});

/** Collecte les appels d'iterChangedRanges sous forme de quadruplets. */
function changesOf(desc: ChangeDesc, individual = false): number[][] {
    const ranges: number[][] = [];
    desc.iterChangedRanges(
        (fromA, toA, fromB, toB) => ranges.push([fromA, toA, fromB, toB]),
        individual,
    );
    return ranges;
}

describe("ChangeDesc.iterChangedRanges — les parties changées", () => {
    const attendus: [string, number[], number[][]][] = [
        ["1 — insertion en 5 : fromA === toA", [5, -1, 0, 3, 6, -1], [[5, 5, 5, 8]]],
        ["2 — suppression [3,6) : fromB === toB", [3, -1, 3, 0, 5, -1], [[3, 6, 3, 3]]],
        [
            "3 — deux remplacements disjoints",
            [1, -1, 2, 1, 4, -1, 2, 2, 2, -1],
            [[1, 3, 1, 2], [7, 9, 6, 8]],
        ],
        ["4 — aucun changement : aucune plage", [11, -1], []],
        ["5 — insertion dans le doc vide", [0, 3], [[0, 0, 0, 3]]],
        ["6 — adjacents : UNE seule plage par défaut", [2, 1, 2, 1, 7, -1], [[0, 4, 0, 2]]],
        ["7 — description vide", [], []],
    ];

    for (const [nom, sections, attendu] of attendus) {
        it(nom, () => {
            expect(changesOf(new ChangeDesc(sections))).toEqual(attendu);
        });
    }

    it("individual: true sépare les sections adjacentes", () => {
        const desc = new ChangeDesc([2, 1, 2, 1, 7, -1]);
        expect(changesOf(desc, true)).toEqual([[0, 2, 0, 1], [2, 4, 1, 2]]);
        expect(changesOf(desc, false)).toEqual([[0, 4, 0, 2]]);
    });

    it("individual ne change rien quand aucune section n'est adjacente", () => {
        for (const [, sections] of attendus) {
            if (sections === attendus[5][1]) continue; // le cas 6, seul concerné
            const desc = new ChangeDesc(sections);
            expect(changesOf(desc, true)).toEqual(changesOf(desc, false));
        }
    });

    it("toA - fromA vaut len, toB - fromB vaut ins", () => {
        // Vrai section par section, donc en mode individual uniquement.
        for (const [, sections] of attendus) {
            const attenduesTailles: number[][] = [];
            for (let i = 0; i < sections.length; i += 2) {
                if (sections[i + 1] >= 0) {
                    attenduesTailles.push([sections[i], sections[i + 1]]);
                }
            }
            const obtenues = changesOf(new ChangeDesc(sections), true).map(
                ([fromA, toA, fromB, toB]) => [toA - fromA, toB - fromB],
            );
            expect(obtenues).toEqual(attenduesTailles);
        }
    });
});

describe("ChangeDesc — trous et changements partitionnent le document", () => {
    const toutes: number[][] = [
        [5, -1, 0, 3, 6, -1],
        [3, -1, 3, 0, 5, -1],
        [1, -1, 2, 1, 4, -1, 2, 2, 2, -1],
        [11, -1],
        [0, 3],
        [2, 1, 2, 1, 7, -1],
        [],
    ];

    /** Vérifie qu'une liste d'intervalles pave [0, fin] sans trou ni recouvrement. */
    function pave(intervalles: number[][], fin: number): void {
        const tries = [...intervalles].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
        let curseur = 0;
        for (const [debut, bout] of tries) {
            expect(debut).toBe(curseur);
            curseur = bout;
        }
        expect(curseur).toBe(fin);
    }

    for (const sections of toutes) {
        it(`[${sections}]`, () => {
            const desc = new ChangeDesc(sections);
            const gaps = gapsOf(desc);
            const changes = changesOf(desc, true);

            pave(
                [
                    ...gaps.map(([posA, , length]) => [posA, posA + length]),
                    ...changes.map(([fromA, toA]) => [fromA, toA]),
                ],
                desc.length,
            );

            pave(
                [
                    ...gaps.map(([, posB, length]) => [posB, posB + length]),
                    ...changes.map(([, , fromB, toB]) => [fromB, toB]),
                ],
                desc.newLength,
            );
        });
    }
});

/** Collecte les appels d'iterChanges, le texte inséré rendu sous forme de string. */
function insertsOf(set: ChangeSet, individual = false): (number | string)[][] {
    const ranges: (number | string)[][] = [];
    set.iterChanges(
        (fromA, toA, fromB, toB, inserted) =>
            ranges.push([fromA, toA, fromB, toB, inserted.toString()]),
        individual,
    );
    return ranges;
}

describe("ChangeSet.iterChanges — le texte inséré en 5ᵉ argument", () => {
    it("cas 1 — insertion en 5", () => {
        const set = new ChangeSet(
            [5, -1, 0, 3, 6, -1],
            [Text.empty, Text.of(["XYZ"])],
        );
        expect(insertsOf(set)).toEqual([[5, 5, 5, 8, "XYZ"]]);
    });

    it("cas 2 — suppression pure : texte vide, et `inserted` peut être []", () => {
        // Aucune section n'insère : le tableau est vide, plus court que les
        // 3 sections. La lecture hors bornes doit rendre Text.empty, pas planter.
        const set = new ChangeSet([3, -1, 3, 0, 5, -1], []);
        expect(insertsOf(set)).toEqual([[3, 6, 3, 3, ""]]);
    });

    it("cas 3 — deux remplacements, chacun son texte", () => {
        const set = new ChangeSet(
            [1, -1, 2, 1, 4, -1, 2, 2, 2, -1],
            [Text.empty, Text.of(["A"]), Text.empty, Text.of(["BB"])],
        );
        expect(insertsOf(set)).toEqual([
            [1, 3, 1, 2, "A"],
            [7, 9, 6, 8, "BB"],
        ]);
    });

    it("cas 5 — insertion dans le document vide", () => {
        const set = new ChangeSet([0, 3], [Text.of(["abc"])]);
        expect(insertsOf(set)).toEqual([[0, 0, 0, 3, "abc"]]);
    });

    it("cas 6 — sections fusionnées : les textes sont RECOLLÉS", () => {
        const set = new ChangeSet(
            [2, 1, 2, 1, 7, -1],
            [Text.of(["X"]), Text.of(["Y"])],
        );
        // Par défaut : une plage, "X" et "Y" recollés par Text.append.
        expect(insertsOf(set)).toEqual([[0, 4, 0, 2, "XY"]]);
        // individual : chaque section garde son texte.
        expect(insertsOf(set, true)).toEqual([
            [0, 2, 0, 1, "X"],
            [2, 4, 1, 2, "Y"],
        ]);
    });

    it("un texte inséré multi-ligne traverse le parcours intact", () => {
        // Text.of(["a", "b"]) vaut "a\nb", donc 3 caractères.
        const set = new ChangeSet(
            [5, -1, 0, 3, 6, -1],
            [Text.empty, Text.of(["a", "b"])],
        );
        expect(set.newLength).toBe(14);
        expect(insertsOf(set)).toEqual([[5, 5, 5, 8, "a\nb"]]);
    });

    it("le recollage n'ajoute PAS de saut de ligne", () => {
        // Text.append ne fait pas de jonction de ligne : ["a","b"] + ["c"]
        // donne "a\nbc", pas "a\nb\nc". C'est le comportement du bloc A4.
        const set = new ChangeSet(
            [1, 2, 1, 1, 9, -1],
            [Text.of(["a", "b"]), Text.of(["c"])],
        );
        expect(insertsOf(set)).toEqual([[0, 2, 0, 3, "a\nbc"]]);
    });

    it("iterChanges et iterChangedRanges décrivent les mêmes plages", () => {
        const set = new ChangeSet(
            [1, -1, 2, 1, 4, -1, 2, 2, 2, -1],
            [Text.empty, Text.of(["A"]), Text.empty, Text.of(["BB"])],
        );
        for (const individual of [false, true]) {
            const avecTexte = insertsOf(set, individual).map((r) => r.slice(0, 4));
            expect(avecTexte).toEqual(changesOf(set, individual));
        }
    });

    it("un ChangeDesc nu n'a pas de textes : toutes les plages sortent vides", () => {
        const desc = new ChangeDesc([5, -1, 0, 3, 6, -1]);
        const textes: string[] = [];
        // Le moteur est le même : on lui passe un f à 5 paramètres via un cast,
        // pour vérifier que l'absence d'`inserted` ne casse rien.
        (desc.iterChangedRanges as unknown as ChangeSet["iterChanges"])(
            (_a, _b, _c, _d, inserted) => textes.push(inserted.toString()),
        );
        expect(textes).toEqual([""]);
    });
});

describe("ChangeSet.empty — la fabrique du changement neutre", () => {
    it("un document non vide : une seule section intacte", () => {
        const set = ChangeSet.empty(11);
        expect(set.sections).toEqual([11, -1]);
        expect(set.inserted).toEqual([]);
        expect(set.length).toBe(11);
        expect(set.newLength).toBe(11);
        expect(set.empty).toBe(true);
        expect(String(set)).toBe("11");
    });

    it("un document vide : le tableau vide, PAS [0, -1]", () => {
        // [0, -1] est interdit par la forme canonique : une section qui
        // consomme 0 caractère et n'insère rien ne décrit rien.
        const set = ChangeSet.empty(0);
        expect(set.sections).toEqual([]);
        expect(set.length).toBe(0);
        expect(set.newLength).toBe(0);
        expect(set.empty).toBe(true);
        expect(String(set)).toBe("");
    });

    it("ne change rien : aucune plage changée, tout le doc en un trou", () => {
        expect(changesOf(ChangeSet.empty(11))).toEqual([]);
        expect(gapsOf(ChangeSet.empty(11))).toEqual([[0, 0, 11]]);
        expect(gapsOf(ChangeSet.empty(0))).toEqual([]);
    });

    it("le getter `empty` et la fabrique `empty` sont deux choses distinctes", () => {
        expect(ChangeSet.empty(11).empty).toBe(true);
        expect(new ChangeSet([11, 0], []).empty).toBe(false);
    });
});

describe("ChangeSet.apply — produire le nouveau document", () => {
    const source = "hello world";
    const doc = Text.of([source]);

    it("cas 1 — insertion", () => {
        const set = new ChangeSet([5, -1, 0, 3, 6, -1], [Text.empty, Text.of(["XYZ"])]);
        expect(set.apply(doc).toString()).toBe("helloXYZ world");
    });

    it("cas 2 — suppression", () => {
        const set = new ChangeSet([3, -1, 3, 0, 5, -1], []);
        expect(set.apply(doc).toString()).toBe("helworld");
    });

    it("cas 3 — deux remplacements de même longueur", () => {
        const set = new ChangeSet(
            [1, -1, 2, 1, 4, -1, 2, 2, 2, -1],
            [Text.empty, Text.of(["A"]), Text.empty, Text.of(["BB"])],
        );
        expect(set.apply(doc).toString()).toBe("hAlo wBBld");
    });

    it("cas discriminant — la 2ᵉ plage retire PLUS qu'elle n'insère", () => {
        // C'est ce cas qui distingue `fromB + (toA - fromA)` de `toB` :
        // avec `toB` on ne retirerait qu'un caractère au lieu de deux.
        const set = new ChangeSet(
            [1, -1, 2, 1, 4, -1, 2, 1, 2, -1],
            [Text.empty, Text.of(["A"]), Text.empty, Text.of(["B"])],
        );
        expect(set.apply(doc).toString()).toBe("hAlo wBld");
    });

    it("cas 6 — sections adjacentes", () => {
        const set = new ChangeSet([2, 1, 2, 1, 7, -1], [Text.of(["X"]), Text.of(["Y"])]);
        expect(set.apply(doc).toString()).toBe("XYo world");
    });

    it("cas 5 — insertion dans le document vide", () => {
        const set = new ChangeSet([0, 3], [Text.of(["abc"])]);
        expect(set.apply(Text.empty).toString()).toBe("abc");
    });

    it("une insertion multi-ligne crée de vraies lignes", () => {
        const set = new ChangeSet([5, -1, 0, 3, 6, -1], [Text.empty, Text.of(["a", "b"])]);
        const resultat = set.apply(doc);
        expect(resultat.toString()).toBe("helloa\nb world");
        expect(resultat.lines).toBe(2);
    });

    it("ne change rien laisse le document tel quel", () => {
        expect(ChangeSet.empty(11).apply(doc).toString()).toBe(source);
        expect(ChangeSet.empty(0).apply(Text.empty).toString()).toBe("");
    });

    it("lève si la longueur du document ne correspond pas", () => {
        const set = new ChangeSet([5, -1, 0, 3, 6, -1], [Text.empty, Text.of(["XYZ"])]);
        expect(() => set.apply(Text.of(["trop court"]))).toThrow(RangeError);
    });

    it("le document d'origine n'est pas muté", () => {
        const set = new ChangeSet([5, -1, 0, 3, 6, -1], [Text.empty, Text.of(["XYZ"])]);
        set.apply(doc);
        expect(doc.toString()).toBe(source);
    });

    it("apply produit exactement newLength caractères", () => {
        const sets = [
            new ChangeSet([5, -1, 0, 3, 6, -1], [Text.empty, Text.of(["XYZ"])]),
            new ChangeSet([3, -1, 3, 0, 5, -1], []),
            new ChangeSet([2, 1, 2, 1, 7, -1], [Text.of(["X"]), Text.of(["Y"])]),
        ];
        for (const set of sets) {
            expect(set.apply(doc).length).toBe(set.newLength);
        }
    });
});

describe("ChangeSet.apply — oracle exhaustif sur un remplacement", () => {
    const source = "hello world";
    const doc = Text.of([source]);

    /** Construit la description canonique d'un unique remplacement [from, to) → insert. */
    function remplacement(from: number, to: number, insert: string): ChangeSet {
        const sections: number[] = [];
        const inserted: Text[] = [];
        if (from > 0) sections.push(from, -1);
        sections.push(to - from, insert.length);
        while (inserted.length < (sections.length - 2) >> 1) inserted.push(Text.empty);
        inserted.push(Text.of(insert.split("\n")));
        if (to < source.length) sections.push(source.length - to, -1);
        return new ChangeSet(sections, inserted);
    }

    for (const insert of ["", "X", "XY", "a\nb"]) {
        it(`insertion ${JSON.stringify(insert)} sur toutes les paires [from, to)`, () => {
            for (let from = 0; from <= source.length; from++) {
                for (let to = from; to <= source.length; to++) {
                    if (from === to && insert === "") continue; // ne décrit rien
                    const set = remplacement(from, to, insert);
                    const attendu =
                        source.slice(0, from) + insert + source.slice(to);
                    expect(set.length, `${from}..${to}`).toBe(source.length);
                    expect(set.newLength, `${from}..${to}`).toBe(attendu.length);
                    expect(set.apply(doc).toString(), `${from}..${to}`).toBe(attendu);
                }
            }
        });
    }
});
