import { describe, expect, it } from "vitest";
import { ChangeDesc, ChangeSet, MapMode } from "../src/state/src/change.ts";
import { Text } from "../src/state/src/text.ts";

/**
 * Bloc B2 — mapPos : faire survivre une position à une modification.
 *
 * Document de référence : "hello world", 11 caractères.
 * mapPos vit sur ChangeDesc : cartographier n'a jamais besoin du texte inséré,
 * seulement de sa longueur.
 */

const LONGUEUR = 11;

/** Insertion de "XYZ" en 5 → "helloXYZ world" (14). */
const insertion = new ChangeDesc([5, -1, 0, 3, 6, -1]);

/** Remplacement de [5, 10) par "AB" → "helloABd" (8). */
const remplacement = new ChangeDesc([5, -1, 5, 2, 1, -1]);

/** Suppression de [5, 10) → "hellod" (6). */
const suppression = new ChangeDesc([5, -1, 5, 0, 1, -1]);

describe("mapPos — insertion pure de 3 caractères en 5", () => {
    it("avant l'insertion, rien ne bouge", () => {
        expect(insertion.mapPos(0)).toBe(0);
        expect(insertion.mapPos(4)).toBe(4);
        expect(insertion.mapPos(4, 1)).toBe(4);
    });

    it("après l'insertion, tout est décalé de +3", () => {
        expect(insertion.mapPos(6)).toBe(9);
        expect(insertion.mapPos(6, 1)).toBe(9);
        expect(insertion.mapPos(11)).toBe(14);
    });

    it("PILE au point d'insertion : c'est assoc qui tranche", () => {
        // Le cas annoncé par PLAN.md : 5 ou 8, aucune réponse n'est correcte
        // dans l'absolu.
        expect(insertion.mapPos(5, -1)).toBe(5); // collé au caractère d'avant
        expect(insertion.mapPos(5, 1)).toBe(8); // collé au caractère d'après
        expect(insertion.mapPos(5)).toBe(5); // assoc vaut -1 par défaut
    });
});

describe("mapPos — remplacement de [5, 10) par 2 caractères", () => {
    it("au DÉBUT de la section changée, assoc ne change rien", () => {
        expect(remplacement.mapPos(5, -1)).toBe(5);
        expect(remplacement.mapPos(5, 1)).toBe(5);
    });

    it("À L'INTÉRIEUR, le contexte a disparu : on choisit un bord", () => {
        expect(remplacement.mapPos(7, -1)).toBe(5); // début du remplacement
        expect(remplacement.mapPos(7, 1)).toBe(7); // fin du remplacement
        expect(remplacement.mapPos(6, -1)).toBe(5);
        expect(remplacement.mapPos(9, 1)).toBe(7);
    });

    it("à la FIN, les deux rendent la fin — c'est la section suivante qui décide", () => {
        expect(remplacement.mapPos(10, -1)).toBe(7);
        expect(remplacement.mapPos(10, 1)).toBe(7);
    });

    it("au-delà, le décalage est celui du document", () => {
        expect(remplacement.mapPos(11)).toBe(8);
        expect(remplacement.newLength).toBe(8);
    });
});

describe("mapPos — bornes", () => {
    it("la fin du document se cartographie sur la nouvelle fin", () => {
        for (const desc of [insertion, remplacement, suppression]) {
            expect(desc.mapPos(desc.length)).toBe(desc.newLength);
        }
    });

    it("lève au-delà de la fin", () => {
        expect(() => insertion.mapPos(12)).toThrow(RangeError);
        expect(() => remplacement.mapPos(100)).toThrow(RangeError);
    });

    it("une description vide est l'identité", () => {
        const rien = ChangeSet.empty(LONGUEUR);
        for (let pos = 0; pos <= LONGUEUR; pos++) {
            expect(rien.mapPos(pos, -1)).toBe(pos);
            expect(rien.mapPos(pos, 1)).toBe(pos);
        }
    });
});

describe("mapPos — invariants", () => {
    const toutes = [insertion, remplacement, suppression,
                    new ChangeDesc([2, 1, 2, 1, 7, -1]),
                    new ChangeDesc([0, 3, 11, -1]),
                    new ChangeDesc([11, 0])];

    it("est croissante au sens large, à assoc fixé", () => {
        for (const desc of toutes) {
            for (const assoc of [-1, 1]) {
                let precedent = -1;
                for (let pos = 0; pos <= desc.length; pos++) {
                    const image = desc.mapPos(pos, assoc);
                    expect(image, `${desc} pos=${pos} assoc=${assoc}`)
                        .toBeGreaterThanOrEqual(precedent);
                    precedent = image;
                }
            }
        }
    });

    it("reste dans [0, newLength]", () => {
        for (const desc of toutes) {
            for (const assoc of [-1, 1]) {
                for (let pos = 0; pos <= desc.length; pos++) {
                    const image = desc.mapPos(pos, assoc);
                    expect(image).toBeGreaterThanOrEqual(0);
                    expect(image).toBeLessThanOrEqual(desc.newLength);
                }
            }
        }
    });

    it("à l'INTÉRIEUR d'un trou, assoc ne change rien", () => {
        // Un trou est une zone intacte : il n'y a aucune ambiguïté à lever,
        // donc les deux associations doivent coïncider.
        for (const desc of toutes) {
            desc.iterGaps((posA, posB, length) => {
                for (let k = 1; k < length; k++) {
                    expect(desc.mapPos(posA + k, -1)).toBe(posB + k);
                    expect(desc.mapPos(posA + k, 1)).toBe(posB + k);
                }
            });
        }
    });

    it("s'accorde avec apply : le caractère désigné est le même des deux côtés", () => {
        // Le vrai test de mapPos : si une position pointe un caractère intact,
        // son image doit pointer LE MÊME caractère dans le document produit.
        //
        // assoc vaut 1 et ce n'est pas un détail : on demande « où est passé le
        // caractère APRÈS cette position », donc on s'associe à lui. Avec -1,
        // une position située juste après une insertion resterait devant elle
        // et désignerait le texte inséré — comportement correct de mapPos, mais
        // pas la question qu'on pose ici.
        const source = "hello world";
        const doc = Text.of([source]);

        const specs: { from: number; to: number; insert: string }[] = [
            { from: 5, to: 5, insert: "XYZ" },
            { from: 5, to: 10, insert: "AB" },
            { from: 5, to: 10, insert: "" },
            { from: 0, to: 2, insert: "Z" },
            { from: 9, to: 11, insert: "long" },
        ];

        for (const spec of specs) {
            const set = ChangeSet.of(spec, source.length);
            const apres = set.apply(doc).toString();
            set.iterGaps((posA, _posB, length) => {
                for (let k = 0; k < length; k++) {
                    const image = set.mapPos(posA + k, 1);
                    expect(apres[image], `${JSON.stringify(spec)} pos=${posA + k}`)
                        .toBe(source[posA + k]);
                }
            });
        }
    });
});

describe("MapMode — sur une suppression de [5, 10)", () => {
    // Le contexte de chaque position, et ce que chaque mode considère perdu.
    const positions = [0, 4, 5, 6, 7, 9, 10, 11];

    it("Simple ne rend jamais null", () => {
        for (const pos of positions) {
            expect(suppression.mapPos(pos, -1, MapMode.Simple)).not.toBeNull();
        }
    });

    it("TrackDel : null STRICTEMENT à l'intérieur de la suppression", () => {
        const nuls = positions.filter(
            (pos) => suppression.mapPos(pos, -1, MapMode.TrackDel) === null,
        );
        expect(nuls).toEqual([6, 7, 9]);
    });

    it("TrackBefore : null quand le caractère AVANT la position est supprimé", () => {
        // Les caractères 5..9 sont supprimés, donc les positions 6..10.
        const nuls = positions.filter(
            (pos) => suppression.mapPos(pos, -1, MapMode.TrackBefore) === null,
        );
        expect(nuls).toEqual([6, 7, 9, 10]);
    });

    it("TrackAfter : null quand le caractère APRÈS la position est supprimé", () => {
        // Les caractères 5..9 sont supprimés, donc les positions 5..9.
        const nuls = positions.filter(
            (pos) => suppression.mapPos(pos, -1, MapMode.TrackAfter) === null,
        );
        expect(nuls).toEqual([5, 6, 7, 9]);
    });

    it("les trois modes désignent bien trois ensembles différents", () => {
        const ensemble = (mode: MapMode) =>
            positions
                .filter((pos) => suppression.mapPos(pos, -1, mode) === null)
                .join(",");
        expect(ensemble(MapMode.TrackDel)).not.toBe(ensemble(MapMode.TrackBefore));
        expect(ensemble(MapMode.TrackBefore)).not.toBe(ensemble(MapMode.TrackAfter));
        expect(ensemble(MapMode.TrackDel)).not.toBe(ensemble(MapMode.TrackAfter));
    });

    it("une insertion pure ne supprime rien : aucun mode ne rend null", () => {
        for (const mode of [MapMode.TrackDel, MapMode.TrackBefore, MapMode.TrackAfter]) {
            for (let pos = 0; pos <= LONGUEUR; pos++) {
                expect(insertion.mapPos(pos, -1, mode), `pos=${pos}`).not.toBeNull();
            }
        }
    });

    it("quand un mode ne rend pas null, il rend la même chose que Simple", () => {
        for (const mode of [MapMode.TrackDel, MapMode.TrackBefore, MapMode.TrackAfter]) {
            for (const desc of [insertion, remplacement, suppression]) {
                for (let pos = 0; pos <= desc.length; pos++) {
                    const suivi = desc.mapPos(pos, -1, mode);
                    if (suivi !== null) expect(suivi).toBe(desc.mapPos(pos, -1));
                }
            }
        }
    });
});
