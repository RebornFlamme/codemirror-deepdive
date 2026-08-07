# minicm — clone pédagogique minimal de CodeMirror 6

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
src/state/rope.ts   Text (abstraite), TextNode, TextLeaf — la structure du document
src/main.ts         point d'entrée (encore le template Vite)
test/rope.test.ts   suite Vitest
```

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

⚠️ Cas non tranché : `new TextLeaf([])` donne `length === -1` avec la formule actuelle.
Soit l'interdire, soit le normaliser en `[""]`.

## Style

Code et commentaires en français. Tests Vitest en français également.
