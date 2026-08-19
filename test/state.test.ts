import { describe, expect, it } from "vitest";
import { EditorState } from "../src/state/src/state.ts";
import { Annotation, Transaction } from "../src/state/src/transaction.ts";
import { EditorSelection } from "../src/state/src/selection.ts";

/**
 * Bloc D2 — l'état et la transaction.
 *
 * Le point de bascule de l'architecture : plus personne ne MODIFIE l'éditeur.
 * On DÉCRIT un passage d'un état au suivant via `update(spec) -> Transaction`,
 * puis on lit `tr.state`. L'ancien état reste intact.
 *
 * C'est aussi le critère de fin de l'étape 1 : partir d'un document, appliquer
 * des modifications, faire suivre un curseur, puis remonter le temps.
 */

describe("EditorState.create — la porte d'entrée", () => {
    it("normalise une string en Text", () => {
        const state = EditorState.create({ doc: "hello" });
        expect(state.doc.toString()).toBe("hello");
    });

    it("document vide par défaut", () => {
        const state = EditorState.create();
        expect(state.doc.toString()).toBe("");
    });

    it("curseur en 0 par défaut", () => {
        const state = EditorState.create({ doc: "abc" });
        expect(state.selection.main.head).toBe(0);
        expect(state.selection.main.empty).toBe(true);
    });

    it("accepte une sélection {anchor, head}", () => {
        const state = EditorState.create({ doc: "hello world", selection: { anchor: 2, head: 5 } });
        expect(state.selection.main.anchor).toBe(2);
        expect(state.selection.main.head).toBe(5);
    });

    it("lève si la sélection sort du document", () => {
        expect(() => EditorState.create({ doc: "abc", selection: { anchor: 99 } })).toThrow();
    });
});

describe("update — décrire le passage à l'état suivant", () => {
    it("applique une insertion", () => {
        const s0 = EditorState.create({ doc: "hello" });
        const tr = s0.update({ changes: { from: 5, insert: " world" } });
        expect(tr.state.doc.toString()).toBe("hello world");
    });

    it("l'ancien état reste intact (immuabilité)", () => {
        const s0 = EditorState.create({ doc: "hello" });
        s0.update({ changes: { from: 5, insert: " world" } }).state; // on force le calcul
        expect(s0.doc.toString()).toBe("hello");
    });

    it("state est mémoïsé — même instance à chaque lecture", () => {
        const s0 = EditorState.create({ doc: "hello" });
        const tr = s0.update({ changes: { from: 0, insert: "X" } });
        expect(tr.state).toBe(tr.state);
    });

    it("tr.state.doc est bien le tr.newDoc calculé", () => {
        const s0 = EditorState.create({ doc: "hello" });
        const tr = s0.update({ changes: { from: 0, insert: "X" } });
        expect(tr.state.doc).toBe(tr.newDoc);
    });

    it("changes() fabrique un ChangeSet dans le repère courant", () => {
        const s0 = EditorState.create({ doc: "hello" });
        const cs = s0.changes({ from: 5, insert: "!" });
        expect(cs.apply(s0.doc).toString()).toBe("hello!");
    });
});

describe("docChanged", () => {
    it("vrai quand le document change", () => {
        const s0 = EditorState.create({ doc: "abc" });
        expect(s0.update({ changes: { from: 0, insert: "x" } }).docChanged).toBe(true);
    });

    it("faux quand rien ne change", () => {
        const s0 = EditorState.create({ doc: "abc" });
        expect(s0.update({}).docChanged).toBe(false);
    });
});

describe("newSelection — le curseur survit (paiement de B2)", () => {
    it("une insertion AVANT le curseur le décale", () => {
        const s0 = EditorState.create({ doc: "hello world", selection: { anchor: 5 } });
        const tr = s0.update({ changes: { from: 2, insert: "XYZ" } });
        expect(tr.newSelection.main.head).toBe(8); // 5 + 3
    });

    it("une insertion APRÈS le curseur le laisse en place", () => {
        const s0 = EditorState.create({ doc: "hello world", selection: { anchor: 5 } });
        const tr = s0.update({ changes: { from: 8, insert: "XYZ" } });
        expect(tr.newSelection.main.head).toBe(5);
    });

    it("sélection absente -> l'ancienne est mappée", () => {
        const s0 = EditorState.create({ doc: "hello world", selection: { anchor: 5 } });
        const tr = s0.update({ changes: { from: 0, insert: "XYZ" } });
        expect(tr.newSelection.main.head).toBe(8);
    });

    it("sélection explicite -> prise telle quelle, pas mappée", () => {
        const s0 = EditorState.create({ doc: "hello world", selection: { anchor: 5 } });
        const tr = s0.update({ changes: { from: 0, insert: "XYZ" }, selection: { anchor: 0 } });
        expect(tr.newSelection.main.head).toBe(0);
    });
});

describe("annotations — métadonnées typées, cherchées par identité de clé", () => {
    it("on relit la valeur par sa clé", () => {
        const Origin = Annotation.define<string>();
        const s0 = EditorState.create({ doc: "abc" });
        const tr = s0.update({ annotations: Origin.of("paste") });
        expect(tr.annotation(Origin)).toBe("paste");
    });

    it("une clé absente rend undefined", () => {
        const Origin = Annotation.define<string>();
        const Autre = Annotation.define<number>();
        const s0 = EditorState.create({ doc: "abc" });
        const tr = s0.update({ annotations: Origin.of("paste") });
        expect(tr.annotation(Autre)).toBeUndefined();
    });

    it("deux clés du MÊME type restent distinctes (identité d'objet)", () => {
        const A = Annotation.define<string>();
        const B = Annotation.define<string>();
        const s0 = EditorState.create({ doc: "abc" });
        const tr = s0.update({ annotations: A.of("x") });
        expect(tr.annotation(A)).toBe("x");
        expect(tr.annotation(B)).toBeUndefined();
    });

    it("plusieurs annotations cohabitent", () => {
        const Origin = Annotation.define<string>();
        const Count = Annotation.define<number>();
        const s0 = EditorState.create({ doc: "abc" });
        const tr = s0.update({ annotations: [Origin.of("paste"), Count.of(42)] });
        expect(tr.annotation(Origin)).toBe("paste");
        expect(tr.annotation(Count)).toBe(42);
    });
});

describe("userEvent — le raccourci et le préfixe pointé", () => {
    it("userEvent devient une annotation lisible par isUserEvent", () => {
        const s0 = EditorState.create({ doc: "abc" });
        const tr = s0.update({ userEvent: "input.paste" });
        expect(tr.annotation(Transaction.userEvent)).toBe("input.paste");
    });

    it("un préfixe suivi d'un point matche", () => {
        const s0 = EditorState.create({ doc: "abc" });
        const tr = s0.update({ userEvent: "input.paste" });
        expect(tr.isUserEvent("input")).toBe(true);
        expect(tr.isUserEvent("input.paste")).toBe(true);
    });

    it("un préfixe qui n'est pas un segment complet NE matche PAS", () => {
        const s0 = EditorState.create({ doc: "abc" });
        const tr = s0.update({ userEvent: "input.paste" });
        expect(tr.isUserEvent("in")).toBe(false);
        expect(tr.isUserEvent("delete")).toBe(false);
    });

    it("sans userEvent, isUserEvent rend false (et ne lève pas)", () => {
        const s0 = EditorState.create({ doc: "abc" });
        const tr = s0.update({});
        expect(tr.isUserEvent("input")).toBe(false);
    });
});

describe("le voyage dans le temps — critère de fin de l'étape 1", () => {
    it("appliquer puis inverser redonne le document d'origine", () => {
        const s0 = EditorState.create({ doc: "hello" });
        const tr = s0.update({ changes: { from: 5, insert: " world" } });
        const s1 = tr.state;
        expect(s1.doc.toString()).toBe("hello world");

        // invert prend le doc D'AVANT pour savoir ce qui a été inséré/supprimé
        const back = tr.changes.invert(s0.doc);
        expect(back.apply(s1.doc).toString()).toBe("hello");
    });

    it("une suite de modifications remonte jusqu'au départ, curseur compris", () => {
        const depart = EditorState.create({ doc: "abcdef", selection: { anchor: 3 } });

        // trois éditions successives
        const tr1 = depart.update({ changes: { from: 0, insert: "XYZ" } });
        const tr2 = tr1.state.update({ changes: { from: 9, insert: "!" } });
        const tr3 = tr2.state.update({ changes: { from: 2, to: 4 } });
        const arrivee = tr3.state;

        // on empile les inverses, chacun contre le doc d'avant SA transaction
        const back3 = tr3.changes.invert(tr2.state.doc);
        const back2 = tr2.changes.invert(tr1.state.doc);
        const back1 = tr1.changes.invert(depart.doc);

        // on remonte le temps
        let doc = arrivee.doc;
        doc = back3.apply(doc);
        doc = back2.apply(doc);
        doc = back1.apply(doc);
        expect(doc.toString()).toBe("abcdef");
    });
});
