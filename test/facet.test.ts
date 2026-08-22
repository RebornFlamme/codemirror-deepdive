import { describe, expect, it } from "vitest";
import { EditorState } from "../src/state/src/state.ts";
import { Facet, StateField, Configuration } from "../src/state/src/facet.ts";

/**
 * Étape 2 réduite — le système d'extensions minimal.
 *
 * Trois pièces : `Facet` (N contributeurs -> 1 valeur combinée), `StateField`
 * (un état qui évolue par transaction), et leur résolution en une `Configuration`
 * branchée dans l'`EditorState`.
 *
 * Version réduite (cf. PLANbis) : pas de précédence, pas de compartiments, pas de
 * facets dynamiques. Tous les providers sont statiques (`of`), donc `combine` tombe
 * une fois à la résolution.
 */

describe("Facet — N contributeurs fondus en UNE valeur", () => {
    it("un combine explicite choisit (tabSize prend le premier)", () => {
        const tabSize = Facet.define<number, number>({ combine: v => (v.length ? v[0] : 4) });
        const config = Configuration.resolve([tabSize.of(2), tabSize.of(8)]);
        expect(config.facet(tabSize)).toBe(2);
    });

    it("le combine par défaut accumule (la sortie EST le tableau des entrées)", () => {
        const handlers = Facet.define<() => void>();
        const f1 = () => {};
        const f2 = () => {};
        const config = Configuration.resolve([handlers.of(f1), handlers.of(f2)]);
        expect(config.facet(handlers)).toEqual([f1, f2]);
    });

    it("aucun contributeur -> le default du facet, pas une erreur", () => {
        const tabSize = Facet.define<number, number>({ combine: v => (v.length ? v[0] : 4) });
        expect(Configuration.resolve([]).facet(tabSize)).toBe(4);
    });

    it("l'arbre d'extensions est aplati (tableaux imbriqués)", () => {
        const tabSize = Facet.define<number, number>({ combine: v => (v.length ? v[0] : 4) });
        const config = Configuration.resolve([[tabSize.of(2)], [[tabSize.of(8)]]]);
        expect(config.facet(tabSize)).toBe(2);
    });
});

describe("StateField — un état qui évolue par transaction (le reducer)", () => {
    const countField = StateField.define<number>({
        create: () => 0,
        update: (n, tr) => (tr.docChanged ? n + 1 : n),
    });

    it("create pose la valeur initiale", () => {
        const s = EditorState.create({ doc: "abc", extensions: [countField] });
        expect(s.field(countField)).toBe(0);
    });

    it("une transaction qui change le doc incrémente", () => {
        const s0 = EditorState.create({ doc: "abc", extensions: [countField] });
        const s1 = s0.update({ changes: { from: 3, insert: "d" } }).state;
        expect(s1.field(countField)).toBe(1);
    });

    it("une transaction sans changement de doc ne bouge pas", () => {
        const s0 = EditorState.create({ doc: "abc", extensions: [countField] });
        const s1 = s0.update({ selection: { anchor: 1 } }).state;
        expect(s1.field(countField)).toBe(0);
    });

    it("deux transactions enchaînées cumulent", () => {
        const s0 = EditorState.create({ doc: "abc", extensions: [countField] });
        const s1 = s0.update({ changes: { from: 3, insert: "d" } }).state;
        const s2 = s1.update({ changes: { from: 4, insert: "e" } }).state;
        expect(s2.field(countField)).toBe(2);
    });

    it("create reçoit le state — il peut lire le doc", () => {
        const lenField = StateField.define<number>({
            create: state => state.doc.length,
            update: v => v,
        });
        const s = EditorState.create({ doc: "hello", extensions: [lenField] });
        expect(s.field(lenField)).toBe(5);
    });

    it("lire un champ non activé lève", () => {
        const autre = StateField.define<number>({ create: () => 0, update: n => n });
        const s = EditorState.create({ doc: "abc", extensions: [countField] });
        expect(() => s.field(autre)).toThrow();
    });
});

describe("state.facet — lecture depuis l'état", () => {
    it("lit un facet contribué, sinon le défaut", () => {
        const tabSize = Facet.define<number, number>({ combine: v => (v.length ? v[0] : 4) });
        const contribue = EditorState.create({ doc: "abc", extensions: [tabSize.of(2)] });
        expect(contribue.facet(tabSize)).toBe(2);
        const nu = EditorState.create({ doc: "abc" });
        expect(nu.facet(tabSize)).toBe(4);
    });
});

describe("immuabilité & partage", () => {
    const countField = StateField.define<number>({
        create: () => 0,
        update: (n, tr) => (tr.docChanged ? n + 1 : n),
    });

    it("l'ancien état garde son ancienne valeur de champ", () => {
        const s0 = EditorState.create({ doc: "abc", extensions: [countField] });
        s0.update({ changes: { from: 3, insert: "d" } }).state; // force le calcul
        expect(s0.field(countField)).toBe(0);
    });

    it("la config est partagée par identité (pas de reconfigure)", () => {
        const s0 = EditorState.create({ doc: "abc", extensions: [countField] });
        const s1 = s0.update({ changes: { from: 3, insert: "d" } }).state;
        expect(s1.config).toBe(s0.config);
    });
});
