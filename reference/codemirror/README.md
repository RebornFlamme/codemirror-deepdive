# Source officiel de CodeMirror 6 — référence en lecture seule

Copie du code source réel de CodeMirror 6, placée dans le repo pour servir de **vérité de
terrain**. Ce dossier n'est ni compilé, ni importé, ni modifié : `tsconfig.json` ne couvre
que `src/` et `test/`, donc rien ici n'entre dans `npm run typecheck` ou dans le build.

## Provenance

Cloné depuis GitHub le **2026-08-07**.

| Paquet | Version | Commit | Date du commit |
|---|---|---|---|
| `@codemirror/state` | 6.6.0 | `9c801279cb83011e6f92af778f4443406e8f1200` | 2026-04-15 |
| `@codemirror/view` | 6.41.0 | `fbff59ba004d80d8c914f64c42586387b08706ac` | 2026-04-15 |
| `@codemirror/commands` | 6.10.3 | `5b9bac974f2c4af3e20b045adef949667872ecad` | 2026-04-15 |

Licence MIT, conservée dans chaque sous-dossier (`state/LICENSE`, etc.). Copyright Marijn
Haverbeke et contributeurs.

Pour rafraîchir :

```sh
git clone --depth 1 https://github.com/codemirror/state.git
# puis copier state/src et state/LICENSE ici, et mettre à jour le tableau ci-dessus
```

---

## ⚠️ Règle d'usage pour les agents

Ce dossier existe pour **empêcher les descriptions de mémoire**, pas pour fournir des
réponses à Julien.

**Autorisé** — lire ces fichiers avant de répondre à toute question d'implémentation, et
s'en servir pour vérifier une affirmation ou corriger une explication.

**Interdit** — recopier ou paraphraser en détail le code d'un module tant que Julien n'a pas
écrit sa propre version de ce module. Tout l'intérêt du projet est qu'il dérive la solution
lui-même ; livrer le corrigé le vide de son sens.

La démarcation en pratique : les **invariants** et les **décisions d'API** se disent
librement (« le `\n` n'est jamais stocké », « `lineAt` lève mais `replace` clampe »). Les
**algorithmes** ne se donnent qu'après coup, ou sur demande explicite de Julien, ou au titre
de l'exception convenue (pseudo-code de `decompose` en cas de blocage prolongé sur A3).

Voir `CLAUDE.md` à la racine pour les règles complètes.

---

## Où regarder, par étape

Les numéros d'étape renvoient à `PLAN.md`, à la racine du repo.

### Étape 1 — noyau immuable

| Fichier | Sujet |
|---|---|
| `state/src/text.ts` | le rope — blocs A1 à A6 |
| `state/src/change.ts` | `ChangeSet` / `ChangeDesc` — blocs B et C |
| `state/src/selection.ts` | sélection multi-plages — bloc D1 |
| `state/src/state.ts` | `EditorState` — bloc D2 |
| `state/src/transaction.ts` | transactions, annotations, effets — bloc D2 |

### Étape 2 — système d'extensions

| Fichier | Sujet |
|---|---|
| `state/src/facet.ts` | facets, champs d'état, précédence, compartiments |
| `state/src/config.ts` | résolution de la configuration |
| `state/src/extension.ts` | types du système d'extensions |

### Étape 3 — vue, DOM et viewport

| Fichier | Sujet |
|---|---|
| `view/src/editorview.ts` | la vue, le dispatch, le cycle de mise à jour |
| `view/src/docview.ts` | rendu du document |
| `view/src/viewstate.ts` | calcul du viewport, plages visibles |
| `view/src/heightmap.ts` | **la height map** — la partie la plus retorse |
| `view/src/domobserver.ts` | observation des mutations DOM |
| `view/src/domchange.ts` | relire le DOM → synthétiser un changement |
| `view/src/domreader.ts` | extraction du texte depuis le DOM |
| `view/src/tile.ts`, `buildtile.ts` | construction des éléments de ligne |

### Étape 4 — décorations & plugins

| Fichier | Sujet |
|---|---|
| `state/src/rangeset.ts` | ⚠️ le `RangeSet` vit dans **state**, pas dans view |
| `view/src/decoration.ts` | mark / line / widget / replace |
| `view/src/extension.ts` | `ViewPlugin`, `ViewUpdate`, facets de la vue |
| `view/src/matchdecorator.ts` | exemple de décorations pilotées par regex |

### Étape 5 — keymap & historique

| Fichier | Sujet |
|---|---|
| `view/src/keymap.ts` | ⚠️ le keymap vit dans **view**, pas dans commands |
| `commands/src/commands.ts` | commandes de déplacement et d'édition |
| `commands/src/history.ts` | **l'historique comme simple champ d'état** |

### Hors parcours, mais instructif

`view/src/bidi.ts` (texte bidirectionnel), `view/src/gutter.ts`, `view/src/tooltip.ts`,
`view/src/panel.ts` — de bons exemples d'extensions non triviales une fois les 5 étapes
finies.
