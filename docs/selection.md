# `selection.ts` — la sélection de l'éditeur

Ce module décrit **où se trouve le curseur** (ou les curseurs) dans le document.
Il repose entièrement sur la géométrie des changements du bloc B (`ChangeDesc.mapPos`)
pour faire *survivre* une sélection à une édition.

Deux classes :

| Classe | Rôle |
|---|---|
| `SelectionRange` | **une** plage : un curseur (plage vide) ou une sélection orientée |
| `EditorSelection` | **l'ensemble** des plages + laquelle est la principale |

---

## 1. `SelectionRange` — une plage

### Le vocabulaire : `from`/`to` vs `anchor`/`head`

Une plage stocke toujours ses bornes **normalisées** : `from <= to`. Le sens de
tirage (a-t-on sélectionné vers la droite ou vers la gauche ?) est retenu à part,
dans le booléen `inverted`.

```
inverted = false          inverted = true
anchor ──▶ head           head ◀── anchor
from       to             from       to
```

- `anchor` : le point **fixe**, là où la sélection a commencé.
- `head` : le point **mobile**, là où le curseur est maintenant.
- `empty` : `from === to`, c'est-à-dire un simple curseur (pas de sélection).

`anchor` et `head` sont des **getters** dérivés de `from`/`to`/`inverted` — on ne
les stocke jamais, on les recalcule. C'est le même principe que le rope : les
positions n'existent que le temps d'un accès.

### Le champ `flags` : trois informations dans un seul entier

Une plage est réallouée à chaque transaction, donc on évite de multiplier les
champs. `flags` empaquette trois données optionnelles à coups de bits :

```
 bits 0-2   niveau bidi        (7 = non renseigné)
 bit  3     AssocBefore    ┐ mutuellement exclusifs
 bit  4     AssocAfter     ┘ aucun des deux = « pas d'association »
 bit  5     (Inverted chez CM6, inutilisé ici — on a préféré un champ booléen)
 bits 6+    goal column        (0xffffff = absente)
```

Les valeurs numériques sont **identiques à CodeMirror 6**, pour que la comparaison
ligne à ligne avec la source reste possible. Trois getters décodent tout ça :

- **`assoc` → `-1 | 0 | 1`** : de quel côté le curseur est « collé ». Une position
  est un interstice entre deux caractères ; au moment d'un retour à la ligne, une
  même position logique a deux emplacements possibles à l'écran, et `assoc`
  départage. Aucun des deux bits → `0`.
- **`bidiLevel` → `number | null`** : niveau de l'algorithme bidirectionnel Unicode
  (pair = gauche→droite, impair = droite→gauche). Codé sur 3 bits ; les niveaux
  réels ne dépassent pas 6, donc `7` sert de sentinelle « non renseigné » → `null`.
- **`goalColumn` → `number | undefined`** : la colonne **visée** en navigation
  verticale. Traverser une ligne courte avec ↑/↓ ne doit pas « oublier » la colonne
  d'origine. Stockée dans les bits de poids fort → on la lit par décalage (`>>`),
  pas par masque.

### `map` — faire survivre la plage à une édition

C'est le cœur du fichier, et c'est là que le bloc B sert :

```ts
map(change: ChangeDesc, assoc = -1): SelectionRange
```

Deux cas :

- **Curseur (plage vide)** : une seule position à remapper, et c'est l'appelant qui
  décide de quel côté elle se colle via `assoc`.
  `from = to = change.mapPos(this.from, assoc)`.

- **Plage non vide** : elle **ignore** l'`assoc` reçu et impose ses propres règles —
  `mapPos(from, 1)` (le début se colle vers la droite) et `mapPos(to, -1)` (la fin
  se colle vers la gauche). Autrement dit **chaque borne se colle au texte qui est
  DANS la plage**. Sans ça, du texte inséré pile à une frontière serait avalé dans
  la sélection, qui grossirait toute seule à chaque frappe.

> **Identité physique** : si rien n'a bougé (`from === this.from && to === this.to`),
> `map` renvoie `this` et non une copie. Les comparaisons en aval deviennent de
> simples `===`. Même optimisation que `Text.empty` au bloc A5.

### `eq` — égalité par position

Deux plages sont égales si elles ont même `anchor`, `head` et `goalColumn`. Les
flags ne sont **pas** comparés dans leur ensemble : deux plages peuvent différer par
leur niveau bidi sans que ça compte. L'`assoc` n'est comparé que si on le demande
(`includeAssoc`), et **seulement pour un curseur** — sur une plage non vide il est
déduit du sens, donc redondant.

---

## 2. `EditorSelection` — l'ensemble des plages

Un éditeur peut avoir **plusieurs curseurs**. `EditorSelection` détient :

- `ranges` : les plages, avec un **invariant fort** (voir plus bas) ;
- `mainIndex` : l'indice de la plage **principale**, celle qu'utilisent les
  commandes mono-curseur. `get main()` la renvoie.

Le constructeur est **privé** : on passe obligatoirement par les fabriques.

### Les fabriques `cursor` et `range`

- **`cursor(pos, assoc?, bidiLevel?, goalColumn?)`** : une plage vide (jamais
  inversée). C'est, avec `range`, le **seul endroit du fichier qui écrit dans
  `flags`** — les trois informations optionnelles s'assemblent au `|`, chacune avec
  sa valeur « absent » (rien pour `assoc`, `7` pour le bidi, `NoGoalColumn` décalé
  pour la colonne).

- **`range(anchor, head, ...)`** : une plage orientée. Elle fait deux choses de plus
  que `cursor` :
  1. **Normaliser** : stocker `from <= to` en retenant le sens dans `inverted`.
  2. **Deviner l'`assoc`** quand on ne le donne pas : une plage non vide se colle au
     caractère qui la prolonge dans son sens de tirage.

  Tirée vers l'arrière (`head < anchor`), elle stocke `from = head`, `to = anchor`,
  `inverted = true`, et l'`assoc` y vaut forcément `1` (`AssocAfter` en dur).

### `map` — remapper toute la sélection

```ts
map(change: ChangeDesc, assoc = -1): EditorSelection
```

Court-circuit si `change.empty` (identité physique, on renvoie `this`). Sinon on
mappe chaque plage… **puis on repasse par `create`**. Ce détour n'est pas décoratif :
après une suppression, deux curseurs distincts peuvent atterrir au même endroit et
doivent **fusionner**. C'est la seule chose que `map` fait de plus que mapper plage
par plage.

### L'invariant, et pourquoi il y a deux fabriques statiques

> **Les plages sont triées par `from` et ne se recouvrent pas — mais deux plages
> non vides peuvent se *toucher*.**

Deux fonctions gardent cet invariant, dans un ordre de coût croissant :

**`create(ranges, mainIndex?)`** — LE point d'entrée. Il vérifie l'invariant en
**une seule passe** et ne paie la normalisation (tri + fusion + allocation) que s'il
est violé. Le cas courant — une sélection déjà correcte — ne coûte donc presque
rien. Le test d'intégrité diffère subtilement selon la nature de la plage :

| plage | test de conflit | pourquoi |
|---|---|---|
| **vide** | `from <= pos` | deux curseurs au même point fusionnent (sinon on verrait un seul curseur mais taper insérerait deux fois) |
| **non vide** | `from < pos` | deux plages qui se *touchent* restent deux sélections légitimes |

**`normalized(ranges, mainIndex?)`** — le chemin lent, appelé seulement quand
l'invariant est cassé. Il reçoit un tableau **mutable** (`create` lui passe une
copie) et :

1. retient la plage principale **par identité** (le tri va bouger les indices) ;
2. trie par `from`, puis récupère le nouvel indice principal via `indexOf` ;
3. balaie et **fusionne** les plages en conflit. La fusion :
   - remplace les deux plages par leur union (`from` du précédent, `max` des `to`) ;
   - **conserve le sens** de la plage absorbée (`range(to, from)` si elle était
     inversée, `range(from, to)` sinon) ;
   - décrémente `mainIndex` si une plage disparaît avant lui ;
   - fait `--i` pour que la boucle repointe sur la plage fusionnée et puisse
     fusionner encore (chaînes de recouvrements).

### `eq`

Deux sélections sont égales si elles ont le même nombre de plages, le même
`mainIndex`, et si chaque plage est `eq` à son homologue de même indice
(l'ordre compte, garanti par l'invariant de tri).

---

## En résumé

```
EditorSelection ── ranges[] ─┬─ SelectionRange (from ≤ to, inverted, flags)
                             ├─ SelectionRange
                             └─ …
                └─ mainIndex ─▶ la plage « active »

flags = bidiLevel | assoc | goalColumn   (un seul entier)

map(change) ──▶ mapPos (bloc B) ──▶ nouvelles bornes ──▶ create ──▶ fusion éventuelle
```

Le fil rouge du fichier est le même que celui du rope et des changements :
**ne stocker que le strict minimum, dériver le reste, et préserver l'identité
physique quand rien n'a changé.**
