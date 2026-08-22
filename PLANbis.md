# PLANbis — la route courte vers un éditeur visible

> **`PLAN.md` reste le document de référence.** Il décrit le parcours complet et ne
> bouge pas. Celui-ci décrit uniquement **l'ordre dans lequel je le traverse**, choisi
> pour atteindre l'étape 3 — un éditeur qu'on voit à l'écran — le plus tôt possible.
>
> Rien n'est retiré du programme. Ce qui est sauté ici est **différé**, avec le point de
> retour indiqué.
>
> Créé le 2026-08-10, après la fin du bloc C1.

---

## Le motif

L'étape 1 est longue et entièrement invisible : 176 tests verts, zéro pixel. Ce qui
m'intéresse le plus est l'étape 3 — `contentEditable`, le viewport, la height map à
hauteurs variables. Plutôt que d'attendre d'avoir fini l'algèbre des changements, je
prends le chemin le plus court jusqu'au premier rendu, et je reviens chercher les pièces
manquantes quand un besoin réel les réclame.

**Le principe de la route** : ne construire une brique que quand quelque chose de
visible la demande. Une brique construite « parce qu'elle est dans le plan » sans client
est une brique qu'on ne comprend pas.

---

## État réel au départ de cette route

| bloc | état |
|---|---|
| A1–A5 — le rope | ✅ `src/state/src/text.ts` |
| A6 — l'itérateur | ⏸ reporté (`PLAN.md` le dit optionnel) |
| B1 — `ChangeDesc` / `ChangeSet` | ✅ `src/state/src/change.ts` |
| B2 — `mapPos` / `MapMode` | ✅ |
| `touchesRange` | ⏸ 5 minutes, client à l'étape 4 |
| C1 — `invertedDesc` / `invert` | ✅ |
| C2 — `compose` | ⏸ **différé** |
| C3 — `map` / rebase | ⏸ **différé** |

176 tests, `npm run typecheck` vert.

---

## Ce que l'étape 3 exige vraiment

Vérifié dans `reference/codemirror/`, pas de mémoire.

| brique | statut |
|---|---|
| `Text` | ✅ |
| `ChangeSet.apply` | ✅ |
| `iterChangedRanges` | ✅ — c'est lui qui pilote le diff DOM minimal |
| `mapPos` | ✅ — la sélection qui suit les modifications |
| `EditorSelection` (D1) | ✅ |
| `EditorState` + `Transaction` (D2) | ✅ |
| facets / `StateField` | ✅ noyau minimal (Facet / StateField / Configuration) |
| `compose` / `map` (C2, C3) | ⚠️ voir les trois trous ci-dessous |

**La vraie dépendance de l'étape 3 n'est pas l'étape 2, c'est le bloc D.** Une vue n'a
rien à afficher sans `EditorState`, rien à dispatcher sans `Transaction`, rien à
synchroniser avec le DOM sans `EditorSelection`.

---

## Les trois trous connus, et ce qu'ils coûtent

Différer C2/C3 n'est pas neutre. Trois conséquences précises, à assumer :

### 1. Un `ViewUpdate` ne pourra pas agréger deux transactions

`view/src/extension.ts:428` :

```ts
this.changes = ChangeSet.empty(this.startState.doc.length)
for (let tr of transactions) this.changes = this.changes.compose(tr.changes)
```

C'est de là que sortent les `changedRanges` du diff DOM. **Mais** avec une seule
transaction, `ChangeSet.empty(n).compose(tr)` tombe sur le raccourci `this.empty ?
other` et `compose` n'est jamais exercé.

→ **Contrainte à respecter** : une transaction à la fois dans un `ViewUpdate`. Le jour
où j'en batche deux, j'ai besoin de C2.

### 2. Pas d'édition multi-curseurs

`state/src/state.ts:155-164`, `changeByRange` — le cœur du multi-curseur — utilise
`compose`, `map` **et** `mapDesc` dans trois lignes consécutives.

La ligne de partage :

| | besoin |
|---|---|
| une sélection multi-plages qui **survit** à une modification | `mapPos` ✅ |
| **éditer** à N curseurs à la fois | `compose` + `map` ❌ |

→ La sélection multi-plages est faite en D1, elle marche. C'est `changeByRange` qui
attend. Mono-curseur pour l'édition jusqu'à C2/C3.

### 3. `ChangeSet.of` garde sa restriction

Les specs doivent rester **triées et disjointes** ; une liste désordonnée lève. CM6
compose les specs entre elles à cet endroit. Pareil pour `mergeTransaction`
(`transaction.ts:315-319`) et les filtres de transaction : compose + map.

→ Pas de filtres de transaction avant C2/C3.

**Point de retour** : je reviens chercher C2 et C3 dès que je veux **l'une** de ces
trois choses — édition multi-curseurs, filtres de transaction, ou l'historique
(étape 5, qui en dépend entièrement).

---

## La route

```
C1 ✅
 └─→ D1 ✅   sélection
      └─→ D2 ✅   état + transaction
           └─→ étape 2 réduite ✅   Extension / Facet / StateField
                └─→ étape 3   la vue, le DOM, le viewport, la height map   ← ICI
```

### D1 — la sélection

`src/state/src/selection.ts`. Deux classes, l'une contenant l'autre :

- **`SelectionRange`** — une plage. `from`/`to` normalisés, plus `anchor`/`head` qui
  disent le *sens* (CM6 les dérive d'un drapeau de bits, pas de deux champs). Porte
  aussi `assoc`, `goalColumn` (la colonne visée en navigation verticale) et
  `bidiLevel` — ces deux derniers sont pour l'étape 3, on peut les poser sans les
  utiliser.
- **`EditorSelection`** — `ranges: readonly SelectionRange[]` + `mainIndex`.
  Fabriques `cursor(pos)`, `range(anchor, head)`, `single(...)`, `create(...)`.

**Le point qui compte** : `map(change: ChangeDesc, assoc = -1)` sur les deux — c'est
`mapPos` qui fait tout le travail, et c'est ici que le bloc B2 sert enfin. Plus
`normalized(...)`, qui trie les plages et fusionne celles qui se recouvrent.

Sauté : `toJSON`/`fromJSON`.

### D2 — l'état et la transaction

`src/state/src/state.ts` et `transaction.ts`.

- **`EditorState`** — `doc: Text` + `selection: EditorSelection`, immuable. Une seule
  façon d'en produire le suivant : `update(spec) → Transaction`, puis `tr.state`.
- **`Transaction`** — `startState`, `changes: ChangeSet`, `selection`, `state`, plus les
  `Annotation` (métadonnées typées : origine, horodatage) et les `StateEffect`.

C'est le point de bascule de l'architecture : plus personne ne *modifie* l'éditeur, on
**décrit** un passage d'un état au suivant.

Sauté en D2 : `mergeTransaction` (plusieurs specs dans un `update`), les filtres
(`changeFilter`, `transactionFilter`), `reconfigure`/`appendConfig`. Les trois demandent
compose ou la configuration.

### Étape 2 réduite

Le minimum qui évite le plombage à défaire ensuite :

1. **`Extension`** — un tableau récursif qu'on aplatit ;
2. **`Facet`** — un point d'extension typé, N contributeurs, **une** fonction de
   combinaison ;
3. **`StateField`** — `create(state)` + `update(value, tr)`, recalculé par transaction.

Sauté franchement : **précédence**, **compartiments**, reconfiguration à chaud.
`PLAN.md` dit que le keymap (étape 5) est la démonstration de l'ordre de précédence —
c'est là que je les ajouterai, avec un vrai client.

**Pourquoi ne pas sauter l'étape 2 entièrement** : sans facets, `EditorView` prendrait un
state nu et j'écrirais en dur ce qui doit venir d'une extension (hauteur de ligne, thème,
gestionnaires DOM). C'est ce plombage-là qu'il faudrait défaire après. Le noyau ci-dessus
coûte une session et donne le bon squelette.

Et l'étape 4 y ramène de force : une décoration n'est pas une valeur qu'on passe à la
vue, c'est une valeur qu'on *dépose dans un facet* que la vue lit. Idem `ViewPlugin`.

### Étape 3 — la vue, le DOM, le viewport (la cible)

**Le découpage canonique est dans `PLAN.md`** : blocs **V** (le rendu, état → DOM), **E**
(l'édition, DOM → état), **H** (viewport & height map), sous-étapes **V1…H3** avec chacune
sa ligne *« Démontrable »*. On ne le duplique pas ici — cette section ne garde que ce qui
relève de la **route** : l'ordre, les contraintes actives, et les simplifications propres au
chemin court.

**Ordre suivi** : `V1 → V2 → E1 → E2 → H1 → H2 → H3`. Logique « pixels le plus tôt » : on
affiche (V), on rend éditable (E), et **seulement ensuite** viewport + height map (H) — la
partie retorse, isolée en fin.

**Contraintes actives** (tant que C2/C3 différés — voir « les trois trous ») :
- **V2** : une seule transaction par `ViewUpdate` (agréger deux → `compose`, C2).
- **E2** : mono-curseur pour l'édition (multi-curseur → `compose` + `map`, C3).

**Simplification propre à la route** :
- **V1** : rendre « un `<div class="cm-line">` par ligne » plutôt que la hiérarchie `Tile`
  de CM6 6.41 (`DocTile`/`LineTile`/`TextTile`/`MarkTile`/`WidgetTile`), qui n'existe **que**
  pour les décorations de l'étape 4. À enrichir en Tiles quand l'étape 4 le réclamera.
  *À valider avec Julien.*

**Différé à l'intérieur de l'étape 3** (points de retour notés) :
- **Décorations** (mark/line/widget/replace) → étape 4, qui **rouvre H3** (un widget change
  une hauteur → invalidation) et introduit les `Tile` de V1.
- **`draw-selection`** (curseur/sélection dessinés en couche) → la sélection native du
  `contentEditable` suffit d'abord ; la couche vient avec le multi-curseur (post-C2/C3).
- **bidi**, **gutters**, **tooltips/panels** → hors parcours (cf. README de `reference/`).
- Rien de tout ça ne connaît les facets → aucun refactor du noyau étape 2 à prévoir.

**Fichiers CM6 de référence** (README de `reference/`) : `editorview.ts`, `docview.ts` (V) ;
`domobserver.ts`, `domreader.ts`, `domchange.ts` (E) ; `heightmap.ts`, `viewstate.ts` (H).

---

## Règles de la route

1. **Chaque brique différée est notée ici**, avec son point de retour. Aucun trou
   silencieux — `CLAUDE.md` l'interdit.
2. **Les simplifications restent des simplifications**, pas des divergences de
   conception. La structure de données ne s'écarte pas de CM6 ; seul l'ordre change.
3. **Une transaction à la fois** tant que C2 n'est pas fait. C'est la seule contrainte
   qui pèse sur le code de la vue, et elle est invisible tant qu'on la respecte.
4. Quand un trou se referme, la ligne correspondante passe en ✅ et la contrainte
   associée tombe.

---

## Journal

| date | événement |
|---|---|
| 2026-08-10 | C1 terminé (176 tests). Décision de la route courte. Création de ce document. |
| 2026-08-11 | **D1 terminé** (223 tests) — `src/state/src/selection.ts`. `extend` laissé de côté (client = les commandes, étape 5), `toJSON`/`fromJSON` omis. Divergence assumée : `inverted` en champ plutôt qu'en bit de `flags`. Prochaine étape : D2. |
| 2026-08-22 | **D2 terminé** — `state.ts` + `transaction.ts` : `EditorState` immuable, `update(spec) -> Transaction`, `tr.state`/`tr.newDoc`/`tr.newSelection` paresseux, annotations + `userEvent`. Sauté (voir « ce que ça coûte ») : `mergeTransaction`, filtres, `reconfigure`. |
| 2026-08-22 | **Étape 2 réduite terminée** (262 tests) — `facet.ts` (`Facet` / `FacetProvider` / `StateField` / `Configuration`) + `flatten` (`extension.ts`), branchés dans `EditorState` : `create` résout la config puis remplit les champs (`field.create(state)`, ordre = `config.fields`), `applyTransaction` les recalcule (`field.update(ancienne, tr)`), lecteurs `state.field(f)` / `state.facet(f)`. **Divergences / simplifications assumées** : valeurs de champs en `Map<StateField, any>` (pas le tableau adressé de CM6, car ni facets dynamiques ni reconfigure) ; `compare` posé mais **sans client** (aucun facet ne dépend d'un champ dans la version réduite) ; sautés franchement : précédence (`Prec`), compartiments, `compute`/`computeN`, `provide`, `toJSON`/`fromJSON`, `init`. Deux pièges verrouillés : un champ ne lit jamais un *autre* champ à l'`update`, et un `update` ne doit jamais appeler `tr.state` (récursion). Simplification à point de retour : **`flatten` ne déduplique pas** (CM6 tient un `seen`) → une même instance comptée deux fois ; inoffensif pour un `combine` « premier », faux pour un `combine` accumulateur ; se referme avec la **précédence (étape 5)**. **Prochaine étape : étape 3 — la vue.** |
