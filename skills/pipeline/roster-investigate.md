---
name: roster-investigate
description: Investigation root-cause — analyse un bug ou comportement inattendu sans modifier le code hors scope.
version: 1.0.0
domain: operational
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Bash, AskUserQuestion]
human_gate: before
tunables:
  auto_freeze_scope: true
  max_hypothesis: 5
artifacts:
  reads: []
  writes:
    - briefs/<task>-investigation.md
pipeline_role:
  triggered_by: /roster-run (bug, régression, comportement inattendu)
  receives: description du symptôme dans $ARGUMENTS
  produces: briefs/<task>-investigation.md avec root cause et plan de fix
---

# Roster Investigate

Tu analyses un bug ou comportement inattendu. Ton travail est de **comprendre**, pas de corriger.
Aucune modification de code sans gate humain explicite.

**Règle fondamentale :** jamais de fix sans investigation complète. Un fix sans root cause est une dette déguisée en solution.

## Input Contract

`$ARGUMENTS` : description du symptôme observé (peut être court).

Si le symptôme est trop vague pour commencer :
> "Décris le comportement observé vs le comportement attendu, et dans quel contexte tu l'as vu."

## Steps

### 1. Gate avant — freeze scope

Si `tunables.auto_freeze_scope: true`, annoncer avant de commencer :
> "Je vais investiguer en mode lecture seule. Je ne modifie aucun fichier sans te le demander explicitement. Le scope d'investigation : [ce qui est pertinent d'après la description]."

Attendre confirmation avant de commencer.

### 2. Comprendre le symptôme

- Reformuler le symptôme en termes précis :
  - Comportement observé
  - Comportement attendu
  - Conditions de reproduction (toujours / parfois / une fois)
  - Contexte (environnement, données, état)
- Identifier le module / fichier / fonction probablement impliqué

### 3. Reproduire (si possible)

```bash
# Tenter de reproduire le symptôme
<commande de reproduction si connue>
```

Si non reproductible → noter et continuer l'analyse statique.

### 4. Formuler des hypothèses

Formuler jusqu'à `tunables.max_hypothesis` hypothèses de root cause, ordonnées par probabilité.

Pour chaque hypothèse :
```
H1 : <description>
  Probabilité : haute / moyenne / faible
  Evidence : <ce qui supporte cette hypothèse dans le code>
  Test : <comment confirmer ou infirmer>
```

### 5. Tester les hypothèses (lecture seule)

Pour chaque hypothèse, dans l'ordre de probabilité :
- Lire le code pertinent
- Tracer le flux d'exécution
- Chercher la preuve ou l'infirmation

```bash
# Outils en lecture seule
git log --oneline -20 -- <fichier>
git blame <fichier>
grep -n "<pattern>" <fichier>
```

Arrêter dès qu'une hypothèse est confirmée avec evidence.

### 6. Identifier la root cause

Formuler la root cause de façon précise :
```
Root cause : <description>
Evidence : <fichier:ligne — citation exacte>
Introduit : <commit ou date si traçable>
Scope d'impact : <ce qui est affecté>
```

Si plusieurs hypothèses restent ouvertes → les lister avec leur niveau de confiance.

### 7. Proposer un plan de fix

Sans toucher au code :
```
Plan de fix :
1. <étape 1 — fichier concerné>
2. <étape 2>

Risques du fix :
- <ce qui pourrait régresser>

Tests à ajouter :
- <test qui aurait détecté ce bug>
```

### 8. Écrire le rapport

Produire `briefs/<task>-investigation.md` :

```markdown
# Investigation — <task-slug>

**Date :** <ISO-8601>
**Symptôme :** <reformulation précise>
**Statut :** ROOT CAUSE IDENTIFIÉE / HYPOTHÈSES EN COURS

## Root Cause

<description précise>
**Evidence :** `<fichier>:<ligne>` — `<citation exacte>`
**Introduit :** <commit ou "indéterminé">

## Hypothèses testées

| # | Hypothèse | Résultat | Evidence |
|---|---|---|---|
| H1 | ... | CONFIRMÉE / INFIRMÉE | `fichier:ligne` |

## Plan de fix

<étapes proposées>

## Tests à ajouter

<tests qui auraient détecté ce bug>

## Scope d'impact

<ce qui est affecté — modules, utilisateurs, données>
```

Présenter le rapport et demander :
> "Root cause identifiée. Veux-tu que je passe à `/roster-intake` pour formaliser le fix, ou tu préfères le faire toi-même ?"

## Output Contract

`briefs/<task>-investigation.md` avec root cause documentée ou hypothèses en cours.

**Si root cause identifiée :** route suggérée vers `/roster-intake` avec le rapport comme contexte.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-investigate",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Jamais de modification de code sans gate humain explicite
- Jamais de fix proposé sans root cause identifiée
- Toute affirmation de cause doit citer le fichier et la ligne
- "Ça ressemble à" n'est pas une root cause — confirmer ou infirmer
- Si reproductible : reproduire avant d'analyser statiquement
