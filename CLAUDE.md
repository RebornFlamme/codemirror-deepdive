# minicm — clone pédagogique minimal de CodeMirror 6

## Instructions 
- Lire PLAN.md avant de commencer à répondre à l'utilisateur absolument, et en entier. 
- Dans le cahier des charges que tu donnes, bien indiquer la signature de la fonction que tu me demandes de coder.
- Je ne veux faire preuve d'aucune initiative par rapport à CodeMirror, les seuls écarts tolérés sont des simplifications pédagogiques que tu me soumettras clairement.  



## Commandes

| But | Commande |
|---|---|
| Dev server | `npm run dev` |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Tests | `npm test` (`vitest run`) — watch : `npm run test:watch` |
| Build | `npm run build` (`tsc && vite build`) |

Stack : Vite 8 + TypeScript 6 + Vitest 4. Pas de framework UI.

**Toujours lancer `npm run typecheck` en plus de `npm test`.** Vitest passe par esbuild,
qui *efface* les types sans les vérifier : une suite verte ne prouve pas que le code
compile. Ce projet a déjà eu 10 erreurs `tsc` avec 18/18 tests au vert.

## Structure

```
src/state/src/text.ts   Text (abstraite), TextNode, TextLeaf, type Line
src/main.ts             point d'entrée (encore le template Vite)
test/rope.test.ts       suite Vitest (importe ../src/state/src/text.ts)
```

Le rope vivait auparavant dans `src/state/rope.ts` ; il a été déplacé vers
`src/state/src/text.ts` pour coller à l'arborescence de CM6. Le test importe le
chemin en dur : **déplacer le module casse silencieusement `npm test`** (vitest
n'échoue que sur la résolution, `tsc` le signale aussi).

`tsconfig.json` inclut `src` et `test`.

## Contraintes tsconfig à connaître

Ces options changent la façon d'écrire les classes — elles expliquent la plupart des
erreurs rencontrées :

- **`strict`** → `strictPropertyInitialization` : tout champ non-`abstract` doit avoir un
  initialiseur ou être assigné dans le constructeur.
- **`useDefineForClassFields: true`** → les champs sont posés via `Object.defineProperty`.
  Un champ *concret* déclaré dans une classe de base **écrase** un getter de sous-classe.
  Les membres de la base doivent donc être `abstract` ou assignés par son constructeur.
- **`noImplicitOverride: true`** → `override` obligatoire pour surcharger un membre concret,
  mais **pas** pour implémenter un membre `abstract`.
- **`allowImportingTsExtensions`** → les imports portent l'extension : `from "./rope.ts"`.
- **`verbatimModuleSyntax`** → `import type` explicite pour les imports de types seuls.

## Design du rope

**Tout est immuable.** Les nœuds ne sont jamais mutés : une édition reconstruit le chemin
racine → feuille et partage les sous-arbres intacts (O(log n) nœuds recréés).

Conséquences à respecter :

- `lines` et `length` sont **calculés dans le constructeur**, jamais via un getter.
  Un getter récursif coûterait O(n) à chaque lecture, ce qui annule l'intérêt du rope.
- TS n'autorise l'écriture d'un champ `readonly` que dans le constructeur de la classe
  **qui le déclare**. Pour des métriques `readonly` sur `Text`, il faut donc les calculer
  dans des variables locales puis les passer à `super(lines, length)` — la boucle avant
  `super()` est légale tant qu'elle ne touche pas `this`.
- Préférer `readonly Text[]` à `Text[]` : `readonly children` n'empêche que la
  réaffectation, pas `children.push(...)`.

### Conventions de comptage

- Une feuille stocke ses lignes dans un `string[]`. `lines === text.length`.
- `length` compte les `\n` : `somme(longueur des lignes) + nb_lignes - 1`.
- Un nœud joint ses enfants par `\n` : `length = somme(enfants) + nb_enfants - 1`,
  `lines = somme(lines des enfants)`.
- `toString()` utilise `join("\n")` — **jamais** de `\n` ajouté en fin. Un document se
  terminant par un saut de ligne se représente par une dernière ligne vide (`["a", ""]`),
  ce qui rend `toString()` réversible avec `split("\n")`.
- Document vide = `[""]` (1 ligne, length 0), **pas** `[]`.

⚠️ Cas non tranché : `new TextLeaf([])` est désormais garde-fou côté `length` (le
`- 1` n'est appliqué que si `text.length !== 0`, donc `length === 0`), mais il reste
incohérent : `lines === 0` et `lineAt(0)` lève. Soit l'interdire, soit le normaliser
en `[""]`.

### `lineAt` / `line` : une seule descente (`lineInner`)

`lineAt(offset)` et `line(n)` partagent un moteur unique, `lineInner(target, isLine,
line, offset)`, déclaré **`abstract` sur `Text`** — sans cette déclaration,
`child.lineInner(...)` ne typecheck pas depuis `TextNode`.

Le principe est la *descente d'information* : au lieu que la feuille remonte pour
savoir où elle se trouve, le parent lui transmet son repère absolu.

- `line` = nombre de lignes situées **avant** ce nœud → la 1ʳᵉ ligne du nœud porte le
  numéro `line + 1`.
- `offset` = offset absolu du **premier caractère** du nœud.
- `TextNode` accumule `cumLength += child.length + 1` (le `+ 1` = le `\n` de jonction)
  et `cumLines += child.lines`, puis récurse sur **`child`**, pas sur `this` (piège :
  `this.lineInner` boucle à l'infini).
- Le test d'appartenance porte sur `target`, pas sur `offset` : `target <= end` avec
  `end = line + cumLines + child.lines` (mode ligne) ou `offset + cumLength +
  child.length` (mode offset).
- Dans `TextLeaf`, `to` est la position du `\n` qui **termine** la ligne, donc
  `target <= to` rattache ce `\n` à la ligne précédente (comportement CM6).
- Ne jamais nommer la variable de boucle `line` dans `TextLeaf.lineInner` : elle
  masquerait le paramètre de décalage de numérotation.
- Les bornes sont validées dans `lineAt`/`line` (`RangeError`) ; le `throw` final de
  `lineInner` est donc inatteignable si les métriques en cache sont correctes.

Invariant utile pour tester : pour tout offset `o`, `lineAt(o)` doit vérifier
`from <= o <= to`, `toString().slice(from, to) === text`, et `line(number)` doit
redonner les mêmes `from`/`to`.

### `decompose` : extraire un intervalle (bloc A3)

```ts
decompose(from: number, to: number, target: Text[], open: Open): void
```

Ne retourne rien : **empile** dans `target` les morceaux couvrant `[from, to)`.
Plusieurs appels sur le même `target` se recollent au fur et à mesure — c'est ce qui
permet à `replace` d'être trois appels sans aucun cas particulier.

`const enum Open { From = 1, To = 2 }` : **drapeaux de bits**, pas un choix parmi deux.
`0` = les deux bords fermés, `Open.From | Open.To` = 3 = les deux ouverts. On teste avec
`&`, on combine avec `|`. Fermé = absence de bit, donc `0` est le défaut sûr et la
truthiness va dans le bon sens.

- **`From` est testé, `To` ne l'est jamais.** Une frontière est partagée entre deux
  morceaux voisins ; comme on empile, seul le côté gauche peut souder (le voisin de
  droite n'existe pas encore). `To` sert uniquement, côté `TextNode`, à interdire
  d'empiler un sous-arbre entier au bord droit — ce qui garantit que le `pop()` de la
  soudure suivante trouve bien une **feuille**.
- **Le raccourci « feuille entière » décide du morceau, pas de la pose.** Un `return`
  après `target.push(this)` saute la soudure (cas du suffixe dans `replace`). Structure :
  `piece = raccourci ? this : new TextLeaf(taillé)`, *puis* un seul bloc de pose.
- **Une seule expression pour les quatre situations** (première ligne / milieu /
  dernière / ligne unique) :
  `line.slice(max(0, from - lineFrom), min(to - lineFrom, line.length))`.
  Sur une ligne du milieu les deux bornes sont neutralisées. Écrire une trichotomie
  premier/milieu/dernier est le piège annoncé par `PLAN.md`.
- **`cumLength` avance pour toutes les lignes**, y compris celles qu'on ignore : c'est un
  compteur de position, pas de contenu. Un `continue` placé avant l'incrément fausse tous
  les offsets suivants.
- **Bornes larges** dans le test d'intersection (`lineTo < from || to < lineFrom` →
  ignorer). Un `<` strict fait perdre une ligne vide sur `decompose(3, 4)`, qui doit
  rendre `"\n"` (deux lignes vides).
- **Pièges JS** : `arr[-1]` est `undefined` (les tableaux n'ont pas d'indices négatifs),
  alors que `str.slice(0, -1)` compte depuis la fin. `concat` **retourne** un tableau,
  il ne mute pas.

Côté `TextNode` :

- `childOpen = open & ((pos <= from ? Open.From : 0) | (end >= to ? Open.To : 0))` — on
  construit d'abord le masque « quels bords de l'intervalle cet enfant touche », puis le
  `&` filtre les deux bords d'un coup. Un enfant du milieu ressort avec `0`.
- `childOpen` sert **deux fois** : il interdit le raccourci de partage
  (`pos >= from && end <= to && !childOpen`) et il est passé à la descente.
- L'intervalle est traduit dans le repère de l'enfant : `child.decompose(from - pos,
  to - pos, ...)`. La feuille reçoit donc des bornes qui débordent (`from` négatif,
  `to > this.length`) — c'est normal, elle ne doit pas lever.
- `pos = end + 1` après chaque enfant (le `\n` de jonction).
- **Pas de raccourci « nœud entier »** : `decompose(0, length)` sur un `TextNode` empile
  ses enfants un par un, pas le nœud lui-même. C'est aussi le comportement de CM6 —
  le partage se joue au niveau des enfants, l'assemblage reconstruira.

Invariant de test : pour toute paire `from <= to`, recoller la décomposition avec
`join("\n")` doit redonner `toString().slice(from, to)`. Une double boucle sur toutes
les paires vaut trente cas écrits à la main. Prendre un arbre dont les frontières
d'enfants **ne coïncident pas** avec les frontières de lignes, sinon on ne teste rien.

### Assemblage et `slice`

```ts
static from(children: Text[], length?: number): Text   // sur TextNode
slice(from: number, to: number = this.length): Text     // concrète sur Text
```

- `TextNode.from` : liste à un élément → le rendre tel quel (ne pas emballer), sinon un
  `TextNode`. Le paramètre `length` de CM6 est une optimisation qui suppose un
  constructeur *recevant* la longueur ; le nôtre la calcule, donc il ne sert à rien tant
  qu'on n'a pas fait A5. C'est aussi `from` qui portera le rééquilibrage.
- `slice` s'écrit **une seule fois sur `Text`** : elle n'appelle que `decompose`
  (abstraite) et l'assemblage. Elle doit rendre `TextNode.from(target)` — prendre
  `target[0]` ne marche que si la découpe tient dans un seul enfant (72 échecs sur
  120 paires sinon).
- **`slice` recadre, `line`/`lineAt` lèvent.** Fonction `clip` au niveau module :
  `from` recadré d'abord, puis `to` borné par le bas avec ce `from` déjà recadré — un
  intervalle inversé devient vide au lieu d'une erreur. `replace` réutilisera `clip`.
- `to: number = this.length` plutôt que `to?: number` : la valeur par défaut rend déjà
  le paramètre optionnel à l'appel, sans réintroduire `undefined` dans le type.
- **`0 as Open` est obligatoire.** Depuis TS 5, un enum numérique n'accepte plus un
  littéral hors de ses membres déclarés — `Open` ne contient que 1 et 2. CM6 écrit le
  même cast.
- `slice(0)` d'un `TextNode` rend un **nouveau** nœud, pas `this` : `decompose` empile
  les enfants un par un. Les sous-arbres, eux, sont bien partagés par identité.

### `replace` et `append` (bloc A4)

```ts
replace(from: number, to: number, text: Text): Text   // concrète sur Text
append(other: Text): Text
```

`replace` = `clip` + **trois** `decompose` dans un même `parts` + `TextNode.from`.
Aucune boucle, et surtout **aucun `if` sur les sauts de ligne** — c'est le critère de
réussite du bloc A énoncé dans `PLAN.md`.

| appel | intervalle | drapeaux |
|---|---|---|
| préfixe | `[0, from)` sur `this` | `Open.To` |
| insertion | `[0, text.length)` sur `text` | `Open.From \| Open.To` |
| suffixe | `[to, this.length)` sur `this` | `Open.From` |

Seuls les bords **extérieurs** restent fermés (début du préfixe, fin du suffixe) : ce sont
les vraies extrémités du document. Les deux jointures internes sont ouvertes des deux côtés.

- `clip(this, ...)` et non `clip(text, ...)` : `from`/`to` sont des positions dans le
  document, pas dans l'insertion.
- Le garde `if (text.length)` protège du cas dégénéré `TextLeaf([])`, dont la soudure
  lirait un `text[0]` inexistant et produirait `"undefined"`. Avec `TextLeaf([""])`
  (le document vide correct) il ne change rien.
- **`append` ne rajoute pas de `\n`.** `a.append(b)` vaut `a.toString() + b.toString()` :
  `["ab","cd"].append(["ef","gh"])` donne `"ab\ncdef\ngh"`. C'est cohérent avec le fait
  que ce soit `replace(length, length, other)` — une insertion en fin de document — et
  c'est aussi le comportement de CM6. Pour ajouter une ligne, insérer `["", ...]`.

Test du bloc : triple boucle `(from, to, insertion)` comparée à
`s.slice(0, f) + ins.join("\n") + s.slice(t)`, avec au moins les insertions `[""]`,
`["X"]`, `["X","Y"]`, `["", ""]`. Vérifier aussi que `length`/`lines` du résultat
correspondent toujours à son `toString()` — la reconstruction doit préserver les
métriques en cache.

### Rééquilibrage (bloc A5)

```ts
const enum Tree { BranchShift = 5, Branch = 1 << Tree.BranchShift }  // 32

static of(text: readonly string[]): Text                 // sur Text
static empty: Text                                       // affecté en bas du module
abstract flatten(target: string[]): void
static split(text: readonly string[], target: Text[]): Text[]   // sur TextLeaf
static from(children: Text[], length?: number): Text            // sur TextNode
```

`Branch` compte des **lignes**, jamais des caractères. `BranchShift` sert aux seuils
dérivés (`>> BranchShift` = /32, `>> (BranchShift ± 1)` = /16 et /64).

**Trois pièces interdépendantes, dans cet ordre :**

1. **Découpe après soudure** dans `TextLeaf.decompose` : si le résultat fusionné dépasse
   `Branch`, empiler **deux** feuilles (`mid = joined.length >> 1`, `slice(0, mid)` et
   `slice(mid)`) au lieu d'une. Sans `else` remettant le `push` simple, le cas courant
   n'empile plus rien.
2. **`Text.of`** : le seul point d'entrée public. Lève sur `[]`, rend `Text.empty` sur
   `[""]`, une feuille sous le seuil, sinon `TextNode.from(TextLeaf.split(...))`.
   C'est le cas de base de l'invariant « aucune feuille > 32 lignes » — sans lui, deux
   moitiés ne suffisent pas (une insertion `new TextLeaf([...1000 lignes])` le casse).
3. **`TextNode.from`** : compter les lignes → effondrement en une feuille sous le seuil
   (via `flatten`) → sinon `chunk = max(Branch, lines >> BranchShift)`, `maxChunk`,
   `minChunk`, puis `add`/`flush` avec quatre branches (ouvrir un nœud trop gros,
   pousser seul un enfant assez gros, fusionner deux petites feuilles voisines, sinon
   empiler dans le paquet courant).

`Text.empty` : `static empty: Text` déclaré sans initialiseur dans `Text`, affecté au
**niveau module après `TextLeaf`** (`Text.empty = new TextLeaf([""])`). Les classes ne
sont pas hoistées — un initialiseur direct lèverait un `ReferenceError` à l'import.
`strictPropertyInitialization` ne s'applique qu'aux champs d'instance, donc pas de `!`.

`flatten` ne soude **rien** : à la jonction entre deux enfants, les deux lignes restent
distinctes. La soudure n'existe que quand un bord est *ouvert*.

Ne pas ajouter de raccourci `if (children.length === 1) return children[0]` en tête de
`from` : CM6 traite ce cas à la fin et dans `flush`. En tête, il court-circuite
l'effondrement (un nœud de 10 lignes doit devenir une feuille).

Mesures de référence après implémentation (`replace` au milieu, en boucle) :

| éditions | lignes | profondeur | feuilles | max lignes/feuille | temps |
|---|---|---|---|---|---|
| 1 000 | 1 001 | 2 | 32 | 32 | 25 ms |
| 5 000 | 5 001 | 4 | 168 | 32 | 74 ms |
| 10 000 | 10 001 | 4 | 330 | 32 | 146 ms |

Avant A5 : profondeur 1, une feuille de 10 001 lignes, temps quadratique.

## Style

Code et commentaires en français. Tests Vitest en français également.
