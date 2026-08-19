# Les facets — `Facet`, `FacetProvider`, `Configuration`

Les trois classes forment une **chaîne de montage** : on définit, on contribue, on
résout. Fil rouge ci-dessous : `tabSize`, la taille de tabulation.

## Les trois rôles en une phrase

| classe | rôle | analogue chez les annotations |
|---|---|---|
| **`Facet`** | la **définition** : la clé **+** la règle pour fondre N valeurs en une | `AnnotationType` (la clé) — mais en plus riche |
| **`FacetProvider`** | **une contribution** : « ce facet reçoit cette valeur » | `Annotation` (la paire) |
| **`Configuration`** | le **résultat résolu** : une valeur finale par facet, prête à lire | *(pas d'équivalent)* |

Les deux premières reprennent le patron des annotations. La troisième est nouvelle, et
c'est elle qui justifie toute la mécanique (voir la fin).

## `Facet` — la définition (créée une fois, au niveau module)

```ts
const tabSize = Facet.define<number, number>({ combine: v => v.length ? v[0] : 4 });
// tabSize = Facet { id: 0, combine: <fn>, default: 4 }
```

Deux choses qu'une annotation n'a pas :

- **une règle de combinaison** (`combine`) : ici « prends la première valeur, ou 4 si
  personne ». Une annotation range **une** valeur ; un facet en fond **plusieurs**.
- **un `default` pré-calculé** = `combine([])` = `4`. Lire un facet auquel personne n'a
  contribué rend `4`, jamais une erreur.

L'`id` (0, 1, 2…) est la clé indexable pour ranger la valeur résolue — l'équivalent de
l'identité d'objet des annotations, mais utilisable dans un tableau.

## `FacetProvider` — une contribution (une feuille de l'arbre d'extensions)

```ts
tabSize.of(2)   // FacetProvider { facet: tabSize, value: 2 }
tabSize.of(8)   // FacetProvider { facet: tabSize, value: 8 }
```

Exactement comme `Origin.of("paste")` produisait une `Annotation`. Ici `tabSize.of(2)`
produit une **contribution** : « le facet `tabSize` reçoit la valeur 2 ». Plusieurs
extensions peuvent contribuer — d'où le pluriel.

## `Configuration` — le résultat résolu (calculé une fois)

C'est là que la chaîne se referme. `resolve` prend l'arbre d'extensions et le
**pré-mâche** :

```ts
const config = Configuration.resolve([ tabSize.of(2), tabSize.of(8) ]);
```

```
Configuration.resolve  ────────────────────────────────────────────────
  1. flatten          [ FP{tabSize,2}, FP{tabSize,8} ]         ← aplatir l'arbre
  2. grouper par id   { 0: [2, 8] }                            ← rassembler par facet
  3. combine          { 0: tabSize.combine([2,8]) } = { 0: 2 } ← fondre en UNE valeur
────────────────────────────────────────────────────────────────────────
  config = { valeurs par id: { 0: 2 } }
```

Et la lecture devient triviale, O(1) :

```ts
config.facet(tabSize)      // → 2                   (va chercher sous id 0)
config.facet(autreFacet)   // → autreFacet.default  (aucun provider → le défaut)
```

## Le flow complet, d'un coup

```
   DÉFINIR (une fois)            tabSize = Facet.define({combine})     ← la clé + la règle
        │
   CONTRIBUER (dans extensions)  tabSize.of(2), tabSize.of(8)          ← des FacetProvider
        │
   RÉSOUDRE (à la création)      Configuration.resolve(extensions)     ← flatten+group+combine
        │                               │
   LIRE (tout le temps)          config.facet(tabSize) → 2             ← O(1), pré-mâché
```

## Pourquoi `Configuration`, alors que les annotations n'ont rien de tel ?

C'est la différence qui éclaire tout. Les annotations sont **scannées à la volée** à
chaque `tr.annotation(clé)` (une simple liste). Les facets, eux, sont **pré-combinés une
fois** dans `Configuration`, puis lus en O(1). Trois raisons :

1. **Fréquence de lecture** : un facet comme « hauteur de ligne » ou « décorations » est
   lu à *chaque rendu*. Rescanner + recombiner à chaque fois serait ruineux.
2. **Plusieurs contributeurs + une règle** : il y a un vrai travail de fusion (`combine`)
   à faire, pas juste « trouver la première paire ». Autant le faire une fois.
3. **Une valeur, pas une liste** : le lecteur veut le résultat combiné (`2`), pas les
   contributions brutes (`[2, 8]`).

## Le `combine` par défaut (l'identité) — accumuler au lieu de choisir

```ts
const handlers = Facet.define<() => void>();      // pas de combine → Output = la liste
Configuration.resolve([ handlers.of(f1), handlers.of(f2) ]).facet(handlers)
// → [f1, f2]   ← combine par défaut = identité, la sortie EST le tableau des entrées
```

C'est le cas des gestionnaires d'événements : on ne « choisit » pas, on les **garde
tous**. `tabSize` choisit (combine = premier), `handlers` accumule (combine = identité).
Le facet encode *la politique de fusion* — c'est toute sa valeur ajoutée sur une
annotation.
