---
description: Entry point du pipeline roster — détecte le contexte et route vers le bon skill.
version: 1.0.0
domain: pipeline
phase: null
preamble: true
friction_log: false
allowed_tools: [Read, AskUserQuestion, Skill]
human_gate: none
---

# Roster Run

Tu es l'entry point du pipeline roster. Ton seul travail est de détecter le contexte et de router vers le skill approprié — pas de faire le travail toi-même.

## Routing

Analyse `$ARGUMENTS` et l'état du repo pour déterminer où en est le projet.

### Table de routing

| Signal détecté | Route vers |
|---|---|
| Tâche floue, nouvelle feature, pas de brief existant | `/roster-intake` |
| `briefs/<task>-intake.md` existe et est validé | `/roster-plan` |
| `briefs/<task>-plan.md` existe et est validé | `/roster-implement` |
| Implémentation terminée, branch prête | `/roster-review` |
| `briefs/<task>-review.json` avec statut GO | `/roster-qa` |
| `briefs/<task>-qa.md` avec statut GO | `/roster-ship` |
| Bug, régression, comportement inattendu | `/roster-investigate` |
| Nouveau projet ou projet existant sans harness | `/roster-init` |
| Analyse périodique, patterns de friction | `/roster-skill-health` |

### Détection

1. Lire `briefs/` — quels fichiers `<task>-*.md` existent pour cette tâche ?
2. Vérifier le statut des artefacts existants (GO / NO-GO / absent)
3. Si $ARGUMENTS est vide ou ambigu, poser **une seule question** :
   > "Qu'est-ce qu'on fait ?" (ne pas proposer de liste, laisser l'utilisateur décrire)

### Annonce

Avant de router, annonce en une ligne :
> "→ je route vers `/roster-<skill>` parce que <raison en 5 mots max>"

### Faux positif acceptable

Un faux positif (router vers un skill non strictement nécessaire) est préférable à un faux négatif (sauter une phase). En cas de doute, route vers la phase la plus en amont.

## Rules

- Ne jamais faire le travail d'un autre skill — router seulement
- Ne jamais router vers plusieurs skills en parallèle depuis ici
- Si aucune route ne correspond, demander à l'utilisateur avant d'inventer
