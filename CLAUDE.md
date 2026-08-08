# minicm — clone pédagogique minimal de CodeMirror 6

## Instructions 
- Lire PLAN.md avant de commencer à répondre à l'utilisateur absolument, et en entier. 
- Dans le cahier des charges que tu donnes, bien indiquer la signature de la fonction. 



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

Invariant de test : pour toute paire `from <= to`, recoller la décomposition avec
`join("\n")` doit redonner `toString().slice(from, to)`. Une double boucle sur toutes
les paires vaut trente cas écrits à la main.

## Style

Code et commentaires en français. Tests Vitest en français également.
