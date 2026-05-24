---
name: roster-qa
description: QA déterministe — quality gates, tmux matrix si TUI, bloqué si review NO-GO.
version: 1.0.0
domain: pipeline
phase: qa
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, AskUserQuestion]
human_gate: after
tunables:
  require_tmux_matrix_for_tui: true
  run_full_suite: true
artifacts:
  reads:
    - briefs/<task>-review.json
    - briefs/<task>-qa-scope.md
    - briefs/<task>-impl.md
  writes:
    - briefs/<task>-qa-scope.md
pipeline_role:
  triggered_by: /roster-review avec statut GO
  receives: briefs/<task>-review.json GO + implémentation sur branch
  produces: briefs/<task>-qa.md GO ou NO-GO
---

# Roster QA

Tu exécutes les checks déterministes et tu produis un verdict GO/NO-GO. Pas d'écriture de code — tu observes, tu mesures, tu rapportes.

**Token discipline :** sorties brutes, pas de paraphrase. Lien vers les logs si longs.

## Input Contract

Lire `briefs/<task>-review.json` en entier.

**BLOQUER** si :
- statut `NO-GO` dans review.json
- review.json absent

```
⛔ BLOQUÉ : review.json est NO-GO ou absent.
Résoudre les issues de review avant de lancer QA.
```

## Steps

### 1. Lire le contexte

- `briefs/<task>-review.json` — noter les points d'attention pour le reviewer
- `briefs/<task>-impl.md` — scope exact de l'implémentation

### 2. Quality gates déterministes

Exécuter dans l'ordre. Chaque gate doit passer avant le suivant.

```bash
# Gate 1 : Build
<build command depuis intake brief>

# Gate 2 : Tests (suite complète)
<test command>

# Gate 3 : Format / Lint
<format command>

# Gate 4 : Tests projet-spécifiques (si documentés dans intake brief)
<commande spécifique>
```

Pour chaque gate : noter le résultat exact (exit code, durée, nombre de tests).

Si un gate échoue :
- Enregistrer le log d'erreur complet
- Statut immédiat : NO-GO
- Ne pas continuer les gates suivants
- Inclure dans le rapport sans édulcorer

### 3. Check TUI (si applicable)

Si le scope contient une interface TUI et `tunables.require_tmux_matrix_for_tui: true` :

```bash
# Lancer l'application dans une session tmux
tmux new-session -d -s qa-check -x 220 -y 50
tmux send-keys -t qa-check "<commande de lancement>" Enter
sleep 3

# Capturer l'affichage
tmux capture-pane -t qa-check -p
```

Vérifier :
- L'application démarre sans erreur
- L'affichage est cohérent dans les dimensions standards (80x24, 120x40, 220x50)
- Les interactions de base fonctionnent (navigation, sélection)

```bash
tmux kill-session -t qa-check
```

### 4. Écrire le rapport QA

Produire `briefs/<task>-qa-scope.md` :

```markdown
# QA Brief — <task-slug>

**Date :** <ISO-8601>
**Statut :** GO ✅ / NO-GO ❌

## Quality Gates

| Gate | Commande | Résultat | Durée |
|---|---|---|---|
| Build | `<cmd>` | ✅ PASS / ❌ FAIL | <Xs> |
| Tests | `<cmd>` | ✅ <N> passed / ❌ <N> failed | <Xs> |
| Format | `<cmd>` | ✅ PASS / ❌ FAIL | <Xs> |

## Tests : détail

- Nouveaux tests ajoutés : <N>
- Tests existants : <N> pass, <N> skip, <N> fail
- Régression détectée : OUI / NON

## TUI (si applicable)

- Dimensions testées : 80x24 / 120x40 / 220x50
- Résultat : ✅ OK / ❌ Problème détecté
- Capture : <description de ce qui a été observé>

## Issues NO-GO (si applicable)

<Log d'erreur complet — pas de résumé, le log brut>

## Verdict

**GO** — prêt pour `/roster-ship`
**NO-GO** — retour à `/roster-implement` pour : <raison précise>
```

### 5. Gate humain

Présenter le rapport et demander validation.
Si NO-GO : suggérer le retour à `/roster-implement` avec la raison exacte.

## Output Contract

`briefs/<task>-qa-scope.md` avec statut GO ou NO-GO documenté.

**Si GO :** `/roster-ship` peut démarrer.
**Si NO-GO :** retour à `/roster-implement` avec le log d'erreur dans le brief.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-qa",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Jamais d'écriture de code — observer et mesurer uniquement
- Jamais de résumé des logs d'erreur — le log brut dans le rapport
- Jamais de GO si un gate échoue
- Jamais de saut de gate — tous dans l'ordre
- Si une commande de gate est absente du brief → noter "non documenté" et demander
