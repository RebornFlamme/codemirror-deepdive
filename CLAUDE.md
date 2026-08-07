# MiniCM — instructions projet

Clone pédagogique minimal de CodeMirror 6. Le but est que **Julien comprenne
l'architecture de CM6 en la réimplémentant lui-même**, pas de produire un éditeur.

📄 **Plan complet, étapes et cahiers des charges : [`PLAN.md`](PLAN.md).** Le lire en début
de session.

Arborescence : `src/` le code de Julien · `PLAN.md` le parcours · `notes/` ses notes
personnelles (**ne pas y écrire**) · `reference/codemirror/` le source officiel de CM6.

---

## ⛔ Règle nº 1 — Claude n'écrit pas de code dans `src/`

Ni implémentations, ni signatures, ni stubs `TODO`, ni noms de méthodes imposés.
Une tentative de livrer un `src/state/text.ts` avec des corps vides a été **rejetée** : le
fichier contenait déjà toute la conception, ce qui est justement ce que Julien veut dériver.

Ce que Claude fournit à la place :

- l'explication du concept et du **pourquoi** (quel besoin le rend nécessaire) ;
- un cahier des charges **en prose**, formulé en capacités à atteindre
  (« savoir répondre à X »), jamais en types à créer — partir des types n'est pas pédagogique ;
- des remarques de correspondance avec le vrai CM6 (fidèle / simplifié / omis) ;
- la relecture **après** que Julien a écrit ;
- la plomberie : `package.json`, `tsconfig`, config Vite/vitest.

Julien écrit tout le reste, tests compris, et choisit noms, types et découpage.

## Règle nº 2 — Indices par paliers

En cas de blocage : invariant → pseudo-code → cas de test isolé. Pas la solution d'emblée.
Julien peut dire « donne-moi la réponse » pour court-circuiter sur un point précis.

## Règle nº 3 — Ne jamais décrire CM6 de mémoire

Sur tout point d'implémentation, **aller lire le source réel avant de répondre**. Demande
explicite de Julien (« ça te laisse moins halluciner »). Des erreurs ont déjà été commises
ainsi — voir la section « Faits vérifiés » du plan, qui recense ce qui a été contrôlé.

Le source officiel est **dans le repo** : [`reference/codemirror/`](reference/codemirror/)
(state 6.6.0, view 6.41.0, commands 6.10.3 — voir son README pour la carte des fichiers par
étape). Pas de fetch réseau nécessaire.

## Règle nº 4 — Le source réel reste caché à Julien

`reference/` sert à **l'agent**, pas à Julien. Ne pas recopier ni paraphraser en détail le
code d'un module tant qu'il n'a pas écrit sa propre version de ce module. On compare
**après**.

Démarcation : les **invariants** et les **décisions d'API** se disent librement (« le `\n`
n'est jamais stocké », « `lineAt` lève mais `replace` clampe »). Les **algorithmes** ne se
donnent qu'après coup, ou sur demande explicite. Exception convenue : le pseudo-code de la
décomposition d'intervalle (bloc A3) en cas de blocage > 30 min.

## Style

Julien apprécie les remarques annotées : encadrés « fidèle / simplifié / omis », schémas
ASCII, invariants explicités. À garder — mais **en chat et en relecture**, pas dans le code.

---

## Stack et commandes

TypeScript ~6.0 · Vite ^8.2 · vitest ^4.1 · **zéro dépendance runtime**.

```
npm run test:watch     vitest en continu
npm run test           une passe
npm run typecheck      tsc --noEmit
npm run dev            serveur Vite (utile à partir de l'étape 3)
```

`tsconfig` : `strict` activé, propriétés de constructeur autorisées, `noUnusedLocals`
volontairement désactivé pour pouvoir laisser des bouts inachevés sans bruit.

⚠️ Le scaffold Vite d'origine (`index.html`, `src/main.ts`, `counter.ts`, `style.css`,
`src/assets/`) est **conservé volontairement**. Ne pas le supprimer sans demander.

## Décisions structurantes déjà prises

| Sujet | Décision |
|---|---|
| Document | **Rope fidèle à CM6** (feuilles/nœuds, séparateur implicite), pas un tableau de lignes |
| Encodage des changements | Sections `[len, ins]` comme CM6 — c'est ce qui rend le mapping possible |
| Viewport (étape 3) | **Height map complète**, hauteurs variables mesurées — pas de version simplifiée |
| Sélection | Multi-plages dès le départ (structurel dans CM6) |
| Découpage | 5 étapes : noyau immuable → extensions → vue+viewport → décorations → keymap+historique |

## Instructions 
- Corrige moi sur la nomenclature. Si j'appelle un objet pas comme dans l'implémentation officielle, fait le moi remarquer. 