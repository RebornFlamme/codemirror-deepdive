# MiniCM — plan du parcours

> Document de référence du projet. À lire en début de session pour reprendre le fil.
> Dernière mise à jour : 2026-08-07.

## Objet

Reconstruire depuis zéro un clone minimal de CodeMirror 6, **dans le but de comprendre son
architecture** — pas de produire un éditeur utilisable. L'objectif final est de pouvoir
ouvrir le vrai source de `@codemirror/state` et `@codemirror/view` et savoir quoi y
chercher.

---

## Méthode de travail — règles fermes

**Julien écrit tout le code. Claude ne code pas.**

| Claude fournit | Julien fait |
|---|---|
| L'explication du concept et du *pourquoi* | **Tout `src/`, conception comprise** |
| Un cahier des charges en prose : capacités à atteindre | Les noms, les types, le découpage |
| Les remarques de correspondance avec le vrai CM6 | Ses tests |
| La relecture après coup | Poser les questions quand ça coince |
| La plomberie (`package.json`, `tsconfig`, Vite, vitest) | |

Règles explicitement convenues :

1. **Rien de Claude dans `src/`** — ni signatures, ni stubs, ni noms de méthodes imposés.
   Une première tentative de livrer `src/state/text.ts` avec des corps `TODO` a été
   rejetée : elle contenait déjà toute la conception.
2. **Les objectifs sont formulés en capacités** (« savoir répondre à X »), jamais en types
   à créer. Partir des types n'est pas pédagogique.
3. **Indices par paliers** si blocage : invariant → pseudo-code → cas de test isolé.
   Julien peut dire « donne-moi la réponse » pour court-circuiter sur un point précis.
4. **Le source réel de CM6 reste caché** jusqu'à ce que Julien ait écrit sa version, puis
   on compare. Exception convenue : le pseudo-code de `decompose` si blocage > 30 min.
5. **Claude ne décrit pas CM6 de mémoire.** Sur tout point d'implémentation, aller lire le
   source réel d'abord (voir « Sources » plus bas). Demande explicite de Julien.
6. Le style de remarques annotées (encadrés « fidèle / simplifié / omis », schémas ASCII)
   est apprécié — le garder, mais en chat et en relecture, pas dans le code.

---

## Stack

TypeScript ~6.0 · Vite ^8.2 · vitest ^4.1 · zéro dépendance runtime.
Scaffold Vite d'origine conservé (`index.html`, `src/main.ts`, `counter.ts`, `style.css`).

```
npm run test:watch     vitest en continu
npm run test           une passe
npm run typecheck      tsc --noEmit
npm run dev            serveur Vite (utile à partir de l'étape 3)
```

`tsconfig` : `strict`, propriétés de constructeur autorisées, pas de `noUnusedLocals`
(pour pouvoir laisser des bouts inachevés sans bruit).

---

## Vue d'ensemble — 5 étapes

| # | Étape | Cœur |
|---|---|---|
| 1 | Le noyau immuable | document en rope, changements comme valeurs, état, transaction |
| 2 | Le système d'extensions | facets, précédence, compartiments, champs d'état |
| 3 | La vue, le DOM et le viewport | contentEditable, height map, rendu partiel |
| 4 | Décorations & plugins | ensembles de plages, widgets, plugins de vue |
| 5 | Keymap & historique | l'historique comme simple champ d'état — le paiement |

---

# Étape 1 — Le noyau immuable

**Objectif** : un document où toute modification est elle-même une valeur — applicable,
interrogeable, inversible, composable, rebasable.

**Critère de fin** : un script Node qui part d'un document, applique une suite de
modifications, fait suivre un curseur à travers, puis remonte le temps jusqu'au document
d'origine, sans jamais rien muter.

## Bloc A — Tenir un document, en rope

**Décision** : structure fidèle à CM6 (rope), pas un tableau de lignes. Choix assumé de
Julien pour rester proche de l'implémentation officielle. Rallonge nettement le bloc.

### A1 — Le séparateur implicite

Deux formes de nœud : une **feuille** qui porte un tableau de lignes, un **nœud interne**
qui porte des enfants. Dans les deux cas, le `\n` **n'est jamais stocké** — il est impliqué
par la frontière entre voisins.

```
Feuille(["ab", "cd", "ef"])
         └──┘  └──┘  └──┘
            ↑     ↑        deux "\n" impliqués, jamais écrits
  length = 2 + 1 + 2 + 1 + 2 = 8

Nœud([enfantA, enfantB])
              ↑                un "\n" impliqué entre les enfants aussi
  length = A.length + 1 + B.length
```

C'est l'invariant qui explique 80 % du fichier réel : le compteur de longueur qui part de
**−1**, et le motif `offset = end + 1` présent dans *tous* les parcours.

*Démontrable* : longueur et nombre de lignes corrects sur un arbre à deux niveaux
construit à la main.

### A2 — Une seule descente pour deux questions

« La ligne n° n » et « la ligne à la position p » sont **le même parcours**, à la clé de
comparaison près : on descend en accumulant un compteur jusqu'à dépasser la cible. CM6 en
fait une seule fonction interne paramétrée par un booléen.

*Démontrable* : les deux interrogations sur un arbre à plusieurs niveaux, y compris aux
frontières d'enfants.

### A3 — Décomposer un intervalle ⭐

La vraie primitive, et la moins intuitive. Collecter dans une liste plate les morceaux
couvrant `[from, to)`. Le point clé : chaque bord peut être **ouvert** ou **fermé**.
Bord ouvert = « ce morceau devra être *recollé* à son voisin » ; bord fermé = « il commence
sa propre ligne ».

*Démontrable* : décomposer divers intervalles, recoller les morceaux, retrouver le bon texte.

### A4 — Remplacer = décomposer trois fois, puis reconstruire

Préfixe (bord droit ouvert) + insertion (deux bords ouverts) + suffixe (bord gauche ouvert)
→ reconstruction.

⚠️ **Test de réussite du bloc** : il ne doit y avoir *aucun* `if` sur la présence de sauts
de ligne, aucun cas particulier « couper une ligne » ou « recoller deux lignes ». Les
drapeaux d'ouverture traitent les deux uniformément. Si tu écris ces `if`, tu es à côté.

### A5 — Rééquilibrer

Reconstruire naïvement dégénère : dix mille frappes et l'arbre devient une liste chaînée.
Il faut un constructeur qui regroupe les enfants en paquets de taille visée, qui s'effondre
en une simple feuille quand le total est petit, et un chemin rapide pour le cas courant
(une modification qui ne touche qu'un seul enfant et ne déséquilibre rien).

*Démontrable* : 10 000 éditions successives, profondeur qui reste logarithmique.

### A6 — Itérer *(optionnel, repoussable)*

Un curseur qui parcourt le document en rendant lignes et sauts de ligne comme valeurs
distinctes. Utile pour la vue ; inutile pour les blocs B–D. Passer outre au premier tour.

## Bloc B — Le changement comme valeur ← *le cœur de l'étape*

### B1 — Décrire une modification sans l'exécuter

Le besoin : en A4, éditer est un appel de fonction — une fois revenu, il ne reste rien,
impossible de dire *ce qui* a changé. Or undo, collaboration, décorations et vue ont tous
besoin d'inspecter la modification **après coup**. Il faut un objet qui la décrit,
séparément du document.

### B2 — Faire survivre les positions ⭐⭐

**La raison d'être de toute la structure.** Le curseur est à 42, quelqu'un insère 3
caractères en 10, le curseur doit passer à 45 — et pareil pour la sélection, les points
d'arrêt, les marqueurs, chaque décoration, **et la height map de l'étape 3**.

```
doc    :  "hello world"
change :  insérer "XYZ" en 5
pos 3  →  3      (avant l'insertion, inchangé)
pos 8  →  11     (après, décalé de +3)
pos 5  →  5 ou 8 ?   ← pile au point d'insertion : ambigu
```

Le dernier cas n'a pas de bonne réponse dans l'absolu, d'où le paramètre d'association que
porte CM6. Même question, en pire, quand la position tombe **à l'intérieur** d'un intervalle
supprimé.

Ne pas bâcler : le curseur n'est que le premier client visible d'un mécanisme dont
dépendront ensuite la sélection, les décorations, les hauteurs de ligne et l'historique.

## Bloc C — L'algèbre des changements

- **C1 — Inverser.** C'est undo. Remarquer qu'il faut le document *d'avant* pour construire
  l'inverse : la description seule ne sait pas ce qu'elle a supprimé.
- **C2 — Composer.** Dix frappes d'affilée fusionnent en une entrée d'historique.
  `composer(a, b)` appliqué au doc == `a` puis `b`.
- **C3 — Rebaser.** Deux modifications construites depuis **le même** document de départ :
  la seconde a des positions périmées, il faut la réécrire pour qu'elle s'applique après la
  première. C'est l'édition collaborative — et, plus près de nous, l'undo d'un changement
  ancien alors que d'autres ont eu lieu depuis.

## Bloc D — L'état

- **D1 — La sélection**, multi-plages (CM6 est multi-curseurs *structurellement*, pas en
  option), qui survit aux modifications via B2.
- **D2 — L'état et la transaction.** Rassembler document + sélection en une valeur immuable
  unique, et n'autoriser qu'une seule façon d'en produire la suivante. C'est le point de
  bascule de l'architecture : plus personne ne *modifie* l'éditeur, on **décrit** un passage
  d'un état au suivant.

---

# Étape 2 — Le système d'extensions

Le facet comme point d'extension typé : N contributeurs déposent des valeurs, une fonction
de combinaison en produit une seule, lue par le reste du système. C'est ce qui fait
qu'ajouter une extension n'est pas un monkey-patch.

À couvrir : extensions récursives et aplaties, précédence, compartiments pour la
reconfiguration à chaud, champs d'état dérivés, recalcul incrémental par transaction.

**Point de contrôle** : le noyau tourne en Node, sans DOM.

---

# Étape 3 — La vue, le DOM et le viewport

**Objectif** : un éditeur qu'on voit et qu'on édite. L'état écrit le DOM, le DOM réécrit
l'état, et seul le visible est rendu — à hauteurs variables.

**Critère de fin** : premier éditeur réellement utilisable. On tape au clavier, l'état
reste seule source de vérité et réimpose son rendu ; un très gros document reste fluide
(seul le viewport existe en DOM).

**L'idée clé de CM6** : on *laisse le navigateur éditer*, puis on relit le DOM, on diffe,
on synthétise un changement et on dispatche.

Trois blocs — **V** (le rendu, état → DOM), **E** (l'édition, DOM → état), **H** (viewport
& height map). V et E sont les deux sens du va-et-vient ; H est le problème d'échelle.
Comme partout dans ce plan, on décrit ici les **capacités** et les **invariants** ; les
algorithmes (diff DOM, structure de la height map, phase de mesure) se cherchent au moment
d'écrire le bloc.

## Bloc V — Le rendu : l'état écrit le DOM

### V1 — L'état possède le DOM

On ne manipule jamais le DOM à la main : l'état est la source de vérité, la vue **écrit**
ce qu'il dit. `EditorView` monte l'ossature `.cm-editor > .cm-scroller > .cm-content`,
détient le `state`, et peint **toutes** les lignes en `.cm-line`. `dispatch(tr)` applique la
transaction et redessine. Pas encore de viewport (tout le doc en DOM) : on veut le premier
pixel.

*Démontrable* : `new EditorView({ state, parent })` affiche le document ; un `dispatch`
d'insertion le change à l'écran.

### V2 — Le changement pilote le rendu

Re-peindre tout à chaque frappe est absurde : `iterChangedRanges` (bloc B) dit exactement
ce qui a bougé, on ne reconstruit que les lignes intersectées. C'est le paiement de B2 côté
écran.

*Démontrable* : insérer un caractère ne recrée qu'**une** seule `.cm-line`.

## Bloc E — L'édition : le navigateur édite, on relit

### E1 — La sélection vit des deux côtés

Avant de laisser éditer, le curseur doit être synchronisé dans les **deux** sens.
État → DOM : écrire la sélection de l'état dans le DOM. DOM → état : lire la sélection DOM,
traduire une position `(node, offset)` en offset document, dispatcher une transaction de
sélection.

⚠️ Piège : quand *on* écrit la sélection DOM, l'observateur se réveille — il faut ignorer
nos propres écritures pour ne pas boucler.

*Démontrable* : cliquer place le curseur dans l'état ; changer la sélection de l'état
repositionne le curseur affiché.

### E2 — Le navigateur édite, on relit

`contentEditable` activé, le navigateur modifie le DOM tout seul ; un observateur
(`MutationObserver`) capte la mutation → on **relit** le texte du DOM → on **diffe** contre
l'état → on **synthétise** un `ChangeSet` → `dispatch`. L'état, seul juge, réimpose ensuite
son rendu.

*Démontrable* : taper au clavier modifie l'**état** (visible via un test/inspecteur), qui
réimpose le rendu.

## Bloc H — Le viewport et la height map — **décision : version complète**

Julien a explicitement choisi la height map à hauteurs variables plutôt qu'une version
simplifiée à hauteur de ligne uniforme. C'est la partie la plus retorse de CM6.

```
.cm-editor
└── .cm-scroller        ← l'élément qui scrolle (overflow: auto)
    ├── .cm-gutters     ← position: sticky
    └── .cm-content     ← contentEditable
        ├── [espace réservé, hauteur = les lignes au-dessus]
        ├── .cm-line    ┐
        ├── .cm-line    ├ seules les lignes du viewport existent en DOM
        ├── .cm-line    ┘
        └── [espace réservé, hauteur = les lignes en dessous]
```

### H1 — Une hauteur par ligne (estimée)

La height map est un arbre **parallèle** au document (nœuds text / gap / branch) qui donne
la position verticale et la hauteur de n'importe quelle ligne, via un oracle de hauteur.
À ce stade, hauteurs **estimées uniformément** — suffisant pour un viewport correct.

*Démontrable* : la map rend une position et une hauteur cohérentes pour toute ligne ;
hauteur totale = fonction du nombre de lignes.

### H2 — Ne rendre que le visible

`scrollTop` → **viewport** (la tranche de lignes visibles). Seules ces lignes existent en
DOM, encadrées de deux **espaces réservés** dont la hauteur (donnée par H1) représente tout
ce qui est au-dessus / en-dessous.

*Démontrable* : un document de 100 000 lignes n'a que ~50 `.cm-line` en DOM ; le scroll
fonctionne.

### H3 — Mesurer sans casser la perf

Les lignes n'ont pas toutes la même hauteur (retour à la ligne, tailles de police…). Il
faut **mesurer** le vrai rendu — mais lire une hauteur force un *reflow*.

```
scrollTop  →  height map  →  viewport (quelles lignes ?)
                                 ↓
                    rendu de la tranche + espaces réservés dimensionnés
                                 ↓
                    phase de MESURE (lectures de layout, groupées)
                                 ↓
              hauteurs réelles ≠ estimées ?  →  corriger la map, re-rendre
```

La séparation mesure / écriture existe précisément parce que lire une hauteur force un
reflow : *toutes* les lectures dans une phase, *toutes* les écritures dans une autre.

*Démontrable* : hauteurs de ligne **variables** exactes, sans reflow en boucle.

⚠️ Étape longue, et **rouverte à l'étape 4** : un widget change une hauteur, il faut
l'invalidation.

**Point de contrôle** : premier éditeur réellement utilisable, viewport compris.

---

# Étape 4 — Décorations & plugins

Ensembles de plages (tableau trié acceptable ici, B-tree chez CM6), décorations
mark / line / widget / replace, découpage d'une ligne en spans, plugins de vue et objet
d'update.

Boucle de retour vers l'étape 3 : invalidation de hauteur sur widget, et l'usage des plages
**visibles** plutôt que du document entier — le piège classique des extensions CM6, qui
annule tout le bénéfice du viewport quand on l'oublie.

---

# Étape 5 — Keymap & historique

Keymap comme facet de liaisons essayées par ordre de précédence jusqu'à ce qu'une réussisse
— démonstration directe de l'utilité de l'ordre introduit à l'étape 2.

Puis l'historique, qui n'est **rien d'autre qu'un champ d'état** contenant deux branches de
changements inversés. Toute l'algèbre du bloc C revient : `inverser` produit l'annulation,
`rebaser` la réécrit face aux modifications survenues depuis. C'est le moment où
« pourquoi immuable ? » fait clic.

---

# Support à construire en parallèle

- **Panneau inspecteur de transactions** dans la démo : chaque dispatch journalisé avec ses
  changements, sa sélection, ses annotations. Le meilleur outil pédagogique du lot — on voit
  l'architecture s'exécuter.
- **Tableau de correspondance** module MiniCM ↔ fichier CM6 réel, à remplir au fil des
  relectures.

---

# Faits vérifiés sur le source réel

Relevés dans `codemirror/state@main/src/text.ts` (583 lignes), le 2026-08-07.
**Ne pas re-décrire ces points de mémoire — ils ont déjà été corrigés une fois.**

- Facteur de branchement : **32 lignes** (`BranchShift = 5`). Ce n'est pas un seuil en
  caractères.
- `Text` est **abstraite**, avec deux sous-classes concrètes : feuille et nœud interne.
- Le `\n` n'est jamais stocké ; le compteur de longueur part de **−1**.
- **Bornes, non uniformes et c'est délibéré** : `line(n)` et `lineAt(pos)` lèvent un
  `RangeError` ; `replace`, `slice` et `sliceString` **clampent** silencieusement. On lève
  sur une *interrogation* absurde, on tolère sur une *édition* dont les bornes peuvent venir
  d'un calcul périmé.
- Construire depuis un tableau vide **lève**. Depuis `[""]`, renvoie la constante document
  vide. ≤ 32 lignes → une seule feuille ; au-delà → arbre équilibré.
- `Line.to` est la position **avant** le saut de ligne. Numérotation **1-based**.
  `Line.length == to - from`.
- Une `Line` est un objet **jetable**, recalculé à la demande, périmé dès que le doc change.

## Sources

Le source officiel est **dans le repo** : [`reference/codemirror/`](reference/codemirror/)
— `state` 6.6.0, `view` 6.41.0, `commands` 6.10.3, clonés le 2026-08-07 (licence MIT
conservée). Son README contient la carte « quel fichier pour quelle étape ». Ce dossier est
hors du `tsconfig` : il n'entre ni dans le typecheck ni dans le build.

⚠️ Les détails algorithmiques de `decompose` et du rééquilibrage sont **délibérément absents
de ce document** : Julien veut les chercher lui-même avant de comparer. `reference/` est un
outil pour l'agent (vérifier plutôt qu'halluciner), pas un corrigé à recopier — voir
`CLAUDE.md`, règle nº 4.

---

# État d'avancement

- [x] Plomberie en place, `npm run typecheck` vert
- [x] **Bloc A** (rope) — `src/state/src/text.ts`
- [x] **Bloc B** (ChangeDesc/ChangeSet, `mapPos`) — `src/state/src/change.ts`
- [x] **Bloc C1** (invert) — C2 (compose) / C3 (rebase) **différés**, voir `PLANbis.md`
- [x] **Bloc D** — D1 sélection (`selection.ts`), D2 état + transaction (`state.ts`, `transaction.ts`)
- [x] **Étape 2 réduite** — Facet / StateField / Configuration (`facet.ts`, `extension.ts`)
- [ ] Étape 3 (vue, DOM, viewport, height map) · Étape 4 · Étape 5

> L'ordre réellement suivi (route courte) et les briques différées avec leur point de
> retour sont dans `PLANbis.md`, qui fait foi sur l'ordre.
