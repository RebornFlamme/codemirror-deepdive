import { describe, expect, it } from "vitest";
import { EditorSelection, SelectionRange, checkSelection } from "../src/state/src/selection.ts";
import { ChangeSet } from "../src/state/src/change.ts";

/**
 * Bloc D1 — la sélection.
 *
 * Deux classes : SelectionRange (une plage orientée, from <= to + le sens à
 * part) et EditorSelection (N plages triées, sans recouvrement, + mainIndex).
 *
 * `map` est le paiement du bloc B2 : c'est mapPos qui fait tout le travail.
 */

const LONGUEUR = 11; // "hello world"

/** Insertion de "XYZ" en 5. */
const insertion5 = ChangeSet.of({ from: 5, insert: "XYZ" }, LONGUEUR);
/** Insertion de "XYZ" en 3. */
const insertion3 = ChangeSet.of({ from: 3, insert: "XYZ" }, LONGUEUR);
/** Insertion de "XYZ" en 8. */
const insertion8 = ChangeSet.of({ from: 8, insert: "XYZ" }, LONGUEUR);
/** Suppression de [3, 8). */
const suppression = ChangeSet.of({ from: 3, to: 8 }, LONGUEUR);

describe("SelectionRange — le sens", () => {
    it("une plage tirée vers l'avant", () => {
        const r = EditorSelection.range(3, 8);
        expect([r.from, r.to]).toEqual([3, 8]);
        expect(r.anchor).toBe(3);
        expect(r.head).toBe(8);
        expect(r.empty).toBe(false);
    });

    it("une plage tirée vers l'arrière : from/to normalisés, sens conservé", () => {
        const r = EditorSelection.range(8, 3);
        expect([r.from, r.to]).toEqual([3, 8]);
        expect(r.anchor).toBe(8);
        expect(r.head).toBe(3);
    });

    it("un curseur est une plage vide", () => {
        const c = EditorSelection.cursor(5);
        expect([c.from, c.to]).toEqual([5, 5]);
        expect(c.anchor).toBe(5);
        expect(c.head).toBe(5);
        expect(c.empty).toBe(true);
    });
});

describe("SelectionRange — l'aller-retour des flags", () => {
    it("assoc", () => {
        expect(EditorSelection.cursor(5).assoc).toBe(0);
        expect(EditorSelection.cursor(5, -1).assoc).toBe(-1);
        expect(EditorSelection.cursor(5, 1).assoc).toBe(1);
    });

    it("bidiLevel, sentinelle comprise", () => {
        expect(EditorSelection.cursor(5).bidiLevel).toBeNull();
        expect(EditorSelection.cursor(5, 0, 0).bidiLevel).toBe(0);
        expect(EditorSelection.cursor(5, 0, 3).bidiLevel).toBe(3);
        expect(EditorSelection.cursor(5, 0, 6).bidiLevel).toBe(6);
    });

    it("bidiLevel est plafonné à 6, sinon il écraserait la sentinelle 7", () => {
        expect(EditorSelection.cursor(5, 0, 7).bidiLevel).toBe(6);
        expect(EditorSelection.cursor(5, 0, 99).bidiLevel).toBe(6);
    });

    it("goalColumn, sentinelle comprise", () => {
        expect(EditorSelection.cursor(5).goalColumn).toBeUndefined();
        expect(EditorSelection.cursor(5, 0, undefined, 0).goalColumn).toBe(0);
        expect(EditorSelection.cursor(5, 0, undefined, 42).goalColumn).toBe(42);
    });

    it("les trois cohabitent dans le même entier sans se marcher dessus", () => {
        const c = EditorSelection.cursor(5, -1, 3, 42);
        expect(c.assoc).toBe(-1);
        expect(c.bidiLevel).toBe(3);
        expect(c.goalColumn).toBe(42);
    });

    it("single() pose bien les sentinelles (flags = 0 mentirait)", () => {
        // Une plage construite avec flags = 0 rendrait bidiLevel 0 au lieu de
        // null et goalColumn 0 au lieu de undefined.
        const r = EditorSelection.single(3, 8).main;
        expect(r.bidiLevel).toBeNull();
        expect(r.goalColumn).toBeUndefined();
    });

    it("une plage non vide déduit son assoc de son sens", () => {
        expect(EditorSelection.range(3, 8).assoc).toBe(-1);
        expect(EditorSelection.range(8, 3).assoc).toBe(1);
        expect(EditorSelection.range(5, 5).assoc).toBe(0);
    });
});

describe("SelectionRange.map — faire survivre une position", () => {
    it("un curseur avant l'insertion ne bouge pas", () => {
        expect(EditorSelection.cursor(2).map(insertion5).from).toBe(2);
    });

    it("un curseur après l'insertion est décalé", () => {
        expect(EditorSelection.cursor(8).map(insertion5).from).toBe(11);
    });

    it("un curseur PILE au point d'insertion suit l'assoc demandé", () => {
        const c = EditorSelection.cursor(5);
        expect(c.map(insertion5, -1).from).toBe(5);
        expect(c.map(insertion5, 1).from).toBe(8);
    });

    it("une plage ne GROSSIT PAS quand on insère à son bord gauche", () => {
        // C'est le test qui justifie le mapPos(from, 1) forcé.
        const r = EditorSelection.range(3, 8).map(insertion3);
        expect([r.from, r.to]).toEqual([6, 11]);
        expect(r.to - r.from).toBe(5); // taille inchangée
    });

    it("une plage ne GROSSIT PAS quand on insère à son bord droit", () => {
        // Et celui-ci justifie le mapPos(to, -1) forcé.
        const r = EditorSelection.range(3, 8).map(insertion8);
        expect([r.from, r.to]).toEqual([3, 8]);
        expect(r.to - r.from).toBe(5);
    });

    it("une plage ignore l'assoc qu'on lui passe", () => {
        const r = EditorSelection.range(3, 8);
        expect(r.map(insertion3, -1).from).toBe(r.map(insertion3, 1).from);
        expect(r.map(insertion8, -1).to).toBe(r.map(insertion8, 1).to);
    });

    it("une plage dont le contenu est supprimé s'effondre", () => {
        const r = EditorSelection.range(4, 7).map(suppression);
        expect(r.empty).toBe(true);
        expect(r.from).toBe(3);
    });

    it("le sens est conservé à travers la modification", () => {
        const r = EditorSelection.range(8, 3).map(insertion8);
        expect(r.anchor).toBeGreaterThan(r.head);
    });

    it("identité physique quand rien ne bouge", () => {
        const r = EditorSelection.range(1, 2);
        expect(r.map(insertion8)).toBe(r);
    });
});

describe("EditorSelection — l'invariant de create", () => {
    it("des plages déjà correctes passent telles quelles", () => {
        const ranges = [EditorSelection.range(0, 2), EditorSelection.range(5, 8)];
        const sel = EditorSelection.create(ranges);
        expect(sel.ranges).toBe(ranges); // aucune copie : rien à normaliser
    });

    it("des plages désordonnées ressortent triées", () => {
        const sel = EditorSelection.create([
            EditorSelection.range(5, 8),
            EditorSelection.range(0, 2),
        ]);
        expect(sel.ranges.map((r) => [r.from, r.to])).toEqual([[0, 2], [5, 8]]);
    });

    it("deux curseurs au même point FUSIONNENT", () => {
        const sel = EditorSelection.create([
            EditorSelection.cursor(5),
            EditorSelection.cursor(5),
        ]);
        expect(sel.ranges.length).toBe(1);
    });

    it("deux plages qui se TOUCHENT restent deux", () => {
        const sel = EditorSelection.create([
            EditorSelection.range(0, 3),
            EditorSelection.range(3, 6),
        ]);
        expect(sel.ranges.length).toBe(2);
    });

    it("deux plages qui se RECOUVRENT fusionnent en leur union", () => {
        const sel = EditorSelection.create([
            EditorSelection.range(0, 5),
            EditorSelection.range(3, 8),
        ]);
        expect(sel.ranges.map((r) => [r.from, r.to])).toEqual([[0, 8]]);
    });

    it("la fusion est en cascade", () => {
        // Trois plages qui se recouvrent deux à deux n'en font qu'une.
        const sel = EditorSelection.create([
            EditorSelection.range(0, 4),
            EditorSelection.range(3, 7),
            EditorSelection.range(6, 10),
        ]);
        expect(sel.ranges.map((r) => [r.from, r.to])).toEqual([[0, 10]]);
    });

    it("la fusion conserve le sens de la plage absorbée", () => {
        const sel = EditorSelection.create([
            EditorSelection.range(0, 5),
            EditorSelection.range(8, 3), // tirée vers l'arrière
        ]);
        const fusion = sel.ranges[0];
        expect([fusion.from, fusion.to]).toEqual([0, 8]);
        expect(fusion.anchor).toBe(8);
        expect(fusion.head).toBe(0);
    });

    it("une sélection sans plage lève", () => {
        expect(() => EditorSelection.create([])).toThrow(RangeError);
    });
});

describe("EditorSelection — mainIndex suit sa plage", () => {
    it("à travers le tri", () => {
        const principale = EditorSelection.range(0, 2);
        const sel = EditorSelection.create([EditorSelection.range(5, 8), principale], 1);
        expect(sel.main.from).toBe(0);
        expect(sel.mainIndex).toBe(0); // elle est passée devant
    });

    it("à travers une fusion", () => {
        const sel = EditorSelection.create(
            [
                EditorSelection.range(0, 4),
                EditorSelection.range(3, 7),
                EditorSelection.range(9, 10),
            ],
            2,
        );
        // Les deux premières fusionnent : la principale recule d'un cran.
        expect(sel.ranges.length).toBe(2);
        expect(sel.mainIndex).toBe(1);
        expect([sel.main.from, sel.main.to]).toEqual([9, 10]);
    });

    it("à travers un map", () => {
        const sel = EditorSelection.create(
            [EditorSelection.cursor(2), EditorSelection.cursor(9)],
            1,
        ).map(insertion5);
        expect(sel.main.from).toBe(12);
    });
});

describe("EditorSelection — les fabriques et les modifications", () => {
    it("single : une plage, mainIndex 0", () => {
        const sel = EditorSelection.single(3, 8);
        expect(sel.ranges.length).toBe(1);
        expect(sel.mainIndex).toBe(0);
        expect(sel.main.anchor).toBe(3);
        expect(sel.main.head).toBe(8);
    });

    it("single sans head : un curseur", () => {
        expect(EditorSelection.single(5).main.empty).toBe(true);
    });

    it("asSingle ne garde que la principale, et préserve l'identité", () => {
        const seule = EditorSelection.single(5);
        expect(seule.asSingle()).toBe(seule);

        const multi = EditorSelection.create(
            [EditorSelection.cursor(2), EditorSelection.cursor(9)],
            1,
        );
        expect(multi.asSingle().ranges.length).toBe(1);
        expect(multi.asSingle().main.from).toBe(9);
        expect(multi.asSingle().mainIndex).toBe(0);
    });

    it("addRange : la nouvelle plage devient principale par défaut", () => {
        const sel = EditorSelection.single(2).addRange(EditorSelection.cursor(9));
        expect(sel.ranges.length).toBe(2);
        expect(sel.main.from).toBe(9);
    });

    it("addRange(main: false) garde l'ancienne principale", () => {
        const sel = EditorSelection.single(2).addRange(EditorSelection.cursor(9), false);
        expect(sel.main.from).toBe(2);
    });

    it("addRange sur un curseur existant fusionne", () => {
        const sel = EditorSelection.single(5).addRange(EditorSelection.cursor(5));
        expect(sel.ranges.length).toBe(1);
    });

    it("replaceRange remplace la principale par défaut", () => {
        const sel = EditorSelection.create(
            [EditorSelection.cursor(2), EditorSelection.cursor(9)],
            1,
        ).replaceRange(EditorSelection.cursor(6));
        expect(sel.ranges.map((r) => r.from)).toEqual([2, 6]);
        expect(sel.main.from).toBe(6);
    });

    it("replaceRange peut viser une autre plage", () => {
        const sel = EditorSelection.create(
            [EditorSelection.cursor(2), EditorSelection.cursor(9)],
            1,
        ).replaceRange(EditorSelection.cursor(0), 0);
        expect(sel.ranges.map((r) => r.from)).toEqual([0, 9]);
        expect(sel.main.from).toBe(9);
    });
});

describe("EditorSelection.map", () => {
    it("un changement vide rend la sélection telle quelle", () => {
        const sel = EditorSelection.single(3, 8);
        expect(sel.map(ChangeSet.empty(LONGUEUR))).toBe(sel);
    });

    it("toutes les plages sont mappées", () => {
        const sel = EditorSelection.create([
            EditorSelection.cursor(2),
            EditorSelection.cursor(9),
        ]).map(insertion5);
        expect(sel.ranges.map((r) => r.from)).toEqual([2, 12]);
    });

    it("deux curseurs qui atterrissent au même point fusionnent", () => {
        // C'est la raison d'être du passage par `create` dans map.
        const sel = EditorSelection.create([
            EditorSelection.cursor(4),
            EditorSelection.cursor(7),
        ]).map(suppression);
        expect(sel.ranges.length).toBe(1);
        expect(sel.main.from).toBe(3);
    });
});

describe("checkSelection", () => {
    it("accepte une sélection qui tient dans le document", () => {
        expect(() => checkSelection(EditorSelection.single(0, LONGUEUR), LONGUEUR))
            .not.toThrow();
    });

    it("lève au-delà du document", () => {
        expect(() => checkSelection(EditorSelection.single(0, 12), LONGUEUR))
            .toThrow(RangeError);
    });
});

describe("eq", () => {
    it("compare par position", () => {
        expect(EditorSelection.range(3, 8).eq(EditorSelection.range(3, 8))).toBe(true);
        expect(EditorSelection.range(3, 8).eq(EditorSelection.range(8, 3))).toBe(false);
    });

    it("ignore l'assoc sauf si on le demande, et seulement sur un curseur", () => {
        const a = EditorSelection.cursor(5, -1);
        const b = EditorSelection.cursor(5, 1);
        expect(a.eq(b)).toBe(true);
        expect(a.eq(b, true)).toBe(false);
    });

    it("une sélection compare toutes ses plages et son mainIndex", () => {
        const a = EditorSelection.create(
            [EditorSelection.cursor(2), EditorSelection.cursor(9)],
            0,
        );
        const b = EditorSelection.create(
            [EditorSelection.cursor(2), EditorSelection.cursor(9)],
            1,
        );
        expect(a.eq(a)).toBe(true);
        expect(a.eq(b)).toBe(false);
    });
});

describe("SelectionRange — construction directe interdite en pratique", () => {
    it("les fabriques sont le seul chemin sensé", () => {
        // Le constructeur reste accessible (divergence assumée avec CM6, qui le
        // rend privé), mais il n'écrit aucune sentinelle : à n'utiliser que
        // depuis cursor/range.
        const brut = new SelectionRange(3, 8, false, 0);
        expect(brut.bidiLevel).toBe(0); // et non null
        expect(brut.goalColumn).toBe(0); // et non undefined
    });
});
