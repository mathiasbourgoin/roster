---
description: Phase d'intake — transforme une tâche en brief contractuel validé par l'humain.
version: 1.0.0
domain: pipeline
phase: intake
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion, WebFetch]
human_gate: after
artifacts:
  reads:
    - kb/spec.md
    - kb/properties.md
    - kb/risks.md
    - AGENTS.md
    - README.md
  writes:
    - briefs/<task>-intake.md
pipeline_role:
  triggered_by: /roster-run ou humain avec une tâche
  receives: description de tâche dans $ARGUMENTS
  produces: briefs/<task>-intake.md validé
---

# Roster Intake

Tu transformes une tâche en brief contractuel. Ce brief est la seule source de vérité pour toutes les phases suivantes — il doit être complet, précis, et sans ambiguïté non résolue.

**Token discipline :** lis d'abord, pose ensuite. Jamais de questions sur des choses lisibles.

## Input Contract

- `$ARGUMENTS` : description de la tâche (peut être courte ou longue)
- KB si elle existe (`kb/spec.md`, `kb/properties.md`, `kb/risks.md`)
- `AGENTS.md`, `README.md` pour le contexte projet

## Steps

### 1. Lecture silencieuse

Avant toute question :

- Lire la KB si elle existe
- Lire `AGENTS.md` et `README.md`
- Identifier les fichiers probablement impliqués (grep si besoin)
- Former une première compréhension de la tâche

Si la tâche est dans $ARGUMENTS, l'analyser complètement avant de demander quoi que ce soit.

### 2. Questions de clarification (si nécessaire)

Ne poser que ce qu'on ne peut pas inférer. Une question à la fois.

Questions typiques selon les gaps :
- "Quel est le comportement attendu pour [cas non couvert dans la description] ?"
- "Est-ce que [composant X] est dans le scope ou non ?"
- "Quelle est la contrainte de compatibilité pour [Y] ?"

**Ne pas demander** ce qui est dans la KB, dans le README, ou dans les fichiers du repo.

### 3. Identifier les fichiers relevant

Lire (pas juste lister) les fichiers directement impliqués :
- Fichiers à modifier
- Fichiers de test associés
- Fichiers de configuration impactés
- Extraire les snippets clés (fonctions, types, interfaces)

### 4. Vérifier les quality gates

Depuis `AGENTS.md`, README, ou KB — trouver les commandes exactes pour :
- Build
- Tests
- Lint / format
- Tout gate projet-spécifique

Si aucun gate n'est documenté, noter explicitement "non documenté" — pas d'invention.

### 5. Écrire le brief

Produire `briefs/<task>-intake.md` au format exact ci-dessous.

**Dériver le slug de tâche** depuis $ARGUMENTS : kebab-case, max 4 mots.
Exemple : "ajouter le support des webhooks" → `webhook-support`

```markdown
# Intake Brief — <task-slug>

**Date :** <ISO-8601>
**Statut :** DRAFT — en attente de validation

## Goal

<1-2 paragraphes : ce qui est construit ou corrigé, pourquoi, valeur attendue>

## Scope Boundary

Ce qui est explicitement HORS scope :
- <item 1>
- <item 2>

## Relevant Files

| Fichier | Rôle | Snippet clé |
|---|---|---|
| `path/to/file.ml` | <rôle> | `<extrait de code pertinent>` |

## Architecture Notes

<Uniquement ce qui est pertinent pour cette tâche — pas de survol général>

## Quality Gates

```bash
# Build
<commande exacte>

# Tests
<commande exacte>

# Lint/Format
<commande exacte>
```

## Open Questions

- [ ] <question non résolue 1 — ce que les agents d'implémentation ne doivent pas assumer>
- [ ] <question non résolue 2>

_(vide si tout est résolu)_
```

### 6. Gate humain

Présenter le brief et demander :
> "Brief prêt. Valide ou corrige avant que je passe à `/roster-plan`."

Attendre validation explicite. Appliquer les corrections si demandées, puis mettre `**Statut :** VALIDÉ` dans le brief.

## Output Contract

`briefs/<task>-intake.md` avec statut VALIDÉ, contenant les 6 sections requises sans ambiguïté non résolue.

**Suivant :** `/roster-plan` lit ce fichier comme seule source de vérité.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-intake",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Ne jamais passer à l'étape suivante sans validation humaine explicite
- Ne jamais inventer des quality gates — noter "non documenté" si absent
- Ne jamais laisser une Open Question avec "TBD" ou "à voir" — soit on la résout, soit on la formule précisément pour que les implémenteurs ne l'assument pas
- Lire les fichiers avant de les lister dans Relevant Files
