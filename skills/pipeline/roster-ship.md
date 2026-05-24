---
name: roster-ship
description: Ship — commits conventionnels, rebase-merge, PR GitHub. Gated sur review + QA go.
version: 1.0.0
domain: pipeline
phase: ship
preamble: true
friction_log: true
allowed_tools: [Read, Bash, AskUserQuestion]
human_gate: both
tunables:
  merge_strategy: rebase-merge
  commit_convention: conventional
  pre_pr_checks: ""
artifacts:
  reads:
    - briefs/<task>-review.json
    - briefs/<task>-qa.md
    - briefs/<task>-impl.md
  writes:
    - PR GitHub (artefact externe — non tracé dans briefs/)
pipeline_role:
  triggered_by: /roster-qa avec statut GO
  receives: branch prête, review.json GO, qa.md GO
  produces: PR ouverte ou statut BLOQUÉ avec raison
---

# Roster Ship

Tu portes la branche de l'implémentation jusqu'au merge. Conventional commits, rebase-merge uniquement, PR avec closing issue. Tu ne shippes jamais sans double gate review + QA.

**Token discipline :** terse — liens pas pastes, un-liner commit subjects.

## Input Contract

Avant toute action, lire :
- `briefs/<task>-review.json` — **BLOQUER** si statut `NO-GO`
- `briefs/<task>-qa.md` — **BLOQUER** si statut `NO-GO`
- `briefs/<task>-impl.md` — pour les messages de commit

Si l'un des deux est NO-GO ou absent :
> ⛔ BLOQUÉ : `<fichier>` est NO-GO ou manquant.
> Résoudre les issues signalées avant de shipper.

## Steps

### 1. Pré-checks

```bash
git status           # repo propre ?
git log --oneline -5 # état de la branche
```

Si le repo est dirty sur des fichiers hors scope de la tâche → signaler et demander quoi faire.

Si `tunables.pre_pr_checks` est défini, l'exécuter et bloquer si échec.

### 2. Commits conventionnels

Depuis `briefs/<task>-impl.md`, construire les commits :

**Format :** `type(scope): description`

Types : `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Règles :
- Description en minuscules, impératif, sans point final, max 72 chars
- Un commit = un changement logique qui compile indépendamment
- Body si nécessaire (pourquoi, pas quoi) — séparé par une ligne vide
- Footer : `Closes #N` si issue référencée

```bash
git add <fichiers scope>
git commit -m "type(scope): description"
```

### 3. Rebase sur main

```bash
git fetch origin
git rebase origin/main
```

Si conflits → résoudre dans le scope de la tâche uniquement. Si conflit hors scope, signaler à l'humain.

### 4. Gate humain — avant push

Présenter :
```
Commits préparés :
  <sha courte> type(scope): description
  ...

Branch : <nom>
Target : main

Push et ouvrir la PR ?
```

Attendre confirmation.

### 5. Push et PR

```bash
git push origin <branch> --force-with-lease
gh pr create \
  --title "type(scope): description" \
  --body "$(cat briefs/<task>-impl.md | head -20)

Closes #N" \
  --base main
```

### 6. Gate humain — merge

Après review et CI verts :
```bash
gh pr merge <N> --rebase --delete-branch
```

**Rebase merge uniquement.** Jamais de merge commit, jamais de squash.

### 7. Confirmation

```
✅ Shippé : PR #N mergée sur main
Branch supprimée : <branch>
Closes : #N
```

## Output Contract

PR GitHub ouverte (puis mergée après approbation humaine), ou statut BLOQUÉ documenté.

**Suivant :** tech-lead / humain avec confirmation de merge.

**Incrémenter le compteur metabolism :** Après un ship GO (PR ouverte ou mergée), incrémenter `completed_tasks` dans `.harness/harness.json` (ou `.claude/harness.json` si `.harness/` absent) :

```bash
# lecture → incrément → écriture (jq requis)
jq '.layers.metabolism.completed_tasks += 1' .harness/harness.json > /tmp/hj && mv /tmp/hj .harness/harness.json
```

Si `jq` n'est pas disponible ou si le fichier n'existe pas, noter l'incrément manqué dans le friction log sans bloquer.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-ship",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Jamais de merge commit — rebase-merge uniquement
- Jamais de push sans gate humain explicite
- Jamais de ship si review.json ou qa.md est NO-GO ou absent
- Jamais de commit avec des fichiers hors scope de la tâche
- Si la CI échoue après push → ne pas merger, signaler
