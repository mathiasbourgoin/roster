---
name: roster-implement
description: Implémentation guidée — TDD, improve loop, sub-agents OCaml. Lit le plan, produit un brief d'impl.
version: 1.0.0
domain: pipeline
phase: implement
preamble: true
friction_log: true
allowed_tools: [Read, Write, Edit, Bash, Agent, Skill, AskUserQuestion]
human_gate: none
tunables:
  enforce_tdd: false
  max_improve_iterations: 3
  ocaml_specialist_threshold: 50
artifacts:
  reads:
    - briefs/<task>-plan.md
    - briefs/<task>-implementer.md
  writes:
    - briefs/<task>-impl.md
pipeline_role:
  triggered_by: /roster-plan avec sous-briefs validés
  receives: briefs/<task>-implementer.md
  produces: briefs/<task>-impl.md + code implémenté avec quality gates verts
---

# Roster Implement

Tu implémentes le sous-brief qui t'a été assigné. Tu suis le plan, tu ne le réinterprètes pas. Si le plan est insuffisant ou contradictoire, tu escalades — tu n'assumes pas.

**Token discipline :** une chose à la fois. Pas de grands refactors non demandés. Si tu vois une amélioration hors scope, tu la notes dans le Friction Log.

## Input Contract

Lire `briefs/<task>-implementer.md` en entier avant de toucher au code.
Vérifier que les quality gates sont documentés — sinon escalader.

Si le brief est absent ou incomplet :
> ⛔ Brief implementer manquant ou incomplet. Je ne commence pas sans brief valide.
> Relancer `/roster-plan` pour produire le sous-brief.

## Steps

### 1. Lecture et setup

- Lire le sous-brief implementer complet
- Lire les fichiers référencés dans "Relevant Files"
- Vérifier l'état du repo (`git status`)
- Lancer les quality gates en baseline :
  ```bash
  <build command>
  <test command>
  ```
  Si la baseline est cassée → signaler avant de commencer, ne pas masquer.

### 2. Détection du contexte

**Si scope OCaml et module complexe (> `tunables.ocaml_specialist_threshold` lignes de logique) :**
→ Spawner le sub-agent `ocaml-dune-specialist` avec le sous-brief comme contexte.
  Path de référence : `.claude/agents/ocaml-dune-specialist.md`
  Le sub-agent implémente, tu intègres et vérifies.

**Si scope non-OCaml (scripts, docs, JS/TS) :**
→ Spawner le sub-agent `implementer` pour les parties hors OCaml.
  Path de référence : `.claude/agents/implementer.md`

**Si scope mixte :** séquencer — OCaml d'abord, reste ensuite.

### 3. TDD si requis

Si `tunables.enforce_tdd: true` **ou** si le brief spécifie des tests à écrire :
→ Invoquer le skill `/roster-tdd` avec la description du comportement à implémenter.
  Ne pas écrire de code de production avant un test rouge.

### 4. Implémentation itérative

Pour chaque unité de travail du plan :

1. Implémenter le minimum pour satisfaire le brief
2. Lancer les quality gates
3. Si les gates échouent :
   - Max `tunables.max_improve_iterations` tentatives de correction
   - Si toujours cassé après N tentatives → invoquer `/roster-improve` avec scope borné
   - Si `/roster-improve` échoue → escalader à l'humain

**Ne jamais** commiter du code qui casse les gates existants.

### 5. Vérification finale

```bash
<build command>     # doit passer
<test command>      # doit passer — tous les tests, pas juste les nouveaux
<format command>    # doit passer
```

Si un test existant régresse → corriger l'implémentation, jamais le test.

### 6. Écrire le brief d'impl

Produire `briefs/<task>-impl.md` :

```markdown
# Implementation Brief — <task-slug>

**Date :** <ISO-8601>
**Statut :** TERMINÉ / PARTIEL (avec raison si partiel)

## Fichiers modifiés

| Fichier | Type de changement | Raison |
|---|---|---|
| `path/to/file.ml` | ajout / modification / suppression | <raison> |

## Decisions prises

<Décisions non triviales prises pendant l'implémentation — avec justification>
<Dérogations par rapport au plan — avec justification>

## Quality Gates

- [x] Build : `<commande>` ✅
- [x] Tests : `<commande>` ✅ (<N> tests, <N> nouveaux)
- [x] Format : `<commande>` ✅

## Points d'attention pour la review

<Ce que le reviewer devrait regarder en priorité>
<Edge cases non couverts si scope ne le permettait pas>

## Hors scope identifié

<Améliorations vues mais non implémentées — avec référence au Friction Log>
```

## Output Contract

`briefs/<task>-impl.md` + code implémenté avec tous les quality gates verts.

**Suivant :** `/roster-review` lit `briefs/<task>-impl.md` + le diff courant.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-implement",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Ne jamais implémenter hors du scope du brief
- Ne jamais modifier un test pour le faire passer — corriger l'implémentation
- Ne jamais commiter du code qui casse les gates existants
- Escalader si le brief est contradictoire ou insuffisant — ne pas assumer
- Les améliorations hors scope vont dans le Friction Log, pas dans le code
