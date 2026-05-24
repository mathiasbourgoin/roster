---
description: Review fix-first avec specialists conditionnels — produit un verdict GO/NO-GO structuré.
version: 1.0.0
domain: pipeline
phase: review
preamble: true
friction_log: true
allowed_tools: [Read, Edit, Bash, Agent, AskUserQuestion]
human_gate: after
tunables:
  auto_fix_threshold_lines: 20
  always_run_spec_compliance: true
artifacts:
  reads:
    - briefs/<task>-impl.md
    - briefs/<task>-reviewer.md
    - git diff (courant)
  writes:
    - briefs/<task>-review.json
pipeline_role:
  triggered_by: /roster-implement terminé
  receives: briefs/<task>-impl.md + diff courant
  produces: briefs/<task>-review.json GO ou NO-GO
---

# Roster Review

Tu fais une review structurée, fix-first. Les corrections mécaniques sont appliquées sans demander. Les ambiguïtés sont groupées en une seule question. Tu produis un verdict JSON structuré.

**Règle d'or :** toute affirmation ("c'est géré", "les tests couvrent ça") doit citer le fichier et la ligne. Jamais "probablement" ou "likely".

## Input Contract

Lire dans l'ordre :
1. `briefs/<task>-reviewer.md` — contexte et points d'attention
2. `briefs/<task>-impl.md` — fichiers modifiés et décisions prises
3. `git diff main...HEAD` — le diff complet

Si `briefs/<task>-impl.md` est absent :
> ⛔ Brief impl manquant. La review ne peut pas démarrer sans connaître le scope de l'implémentation.

## Steps

### 1. Lecture du diff

```bash
git diff main...HEAD
git log main...HEAD --oneline
```

Lire chaque fichier modifié dans son intégralité — pas juste les lignes diff.

### 2. Fix-first : corrections auto

Appliquer sans demander les corrections mécaniques suivantes :

| Catégorie | Exemples | Seuil auto-fix |
|---|---|---|
| Dead code | Variables non utilisées, imports inutilisés | Toujours |
| Magic numbers | Constantes inline → constantes nommées | Toujours |
| Commentaires stale | Commentaires qui contredisent le code | Toujours |
| Style / format | Incohérences de style locales, trailing whitespace | Toujours |
| DRY évident | Bloc identique copy-paste 3+ lignes | Si < `tunables.auto_fix_threshold_lines` |

**Ne pas auto-fixer :**
- Sécurité (auth, injection, XSS) → toujours dans les findings
- Race conditions → toujours dans les findings
- Changements de comportement visible → toujours demander
- Refactors > `tunables.auto_fix_threshold_lines` lignes → toujours demander

Après chaque fix auto, vérifier que les quality gates passent encore.

### 3. Specialists conditionnels

Spawner les specialists selon le scope. Chaque specialist reçoit :
- Le diff complet
- Le `briefs/<task>-reviewer.md`
- Ses instructions propres (path ci-dessous)

| Specialist | Condition | Path |
|---|---|---|
| `spec-compliance` | Toujours si KB existe | `.claude/agents/` — lire `skills/kb/spec-compliance-auditor.md` |
| `architect` | Blast radius moyen ou large (>3 fichiers modifiés ou module public) | `.claude/agents/architect.md` |
| `terminal-ux-reviewer` | Scope TUI détecté dans le diff ou le brief | `.claude/agents/terminal-ux-reviewer.md` |
| `reviewer` (agent) | Toujours | `.claude/agents/reviewer.md` |

**Format de findings attendu de chaque specialist :**

```json
{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
  "confidence": 1-5,
  "path": "file/path.ml",
  "line": 42,
  "category": "correctness|security|architecture|ux|spec|style",
  "summary": "Description courte du problème",
  "evidence": "Fichier X ligne Y — citation exacte du code",
  "fix": "Ce qu'il faut faire",
  "fingerprint": "path:line:category",
  "specialist": "architect|reviewer|spec-compliance|terminal-ux-reviewer"
}
```

### 4. Déduplication

Si deux specialists signalent le même finding (même `fingerprint` ou même path+line+category) :
- Garder le finding avec la severity la plus haute
- Mentionner que les deux specialists ont convergé (signal de confiance)

### 5. Grouper les ambiguïtés

Collecter tous les findings qui nécessitent une décision humaine (severity HIGH+ sur des changements de comportement, sécurité, design).

Présenter en **une seule** `AskUserQuestion` :

```
J'ai des questions sur [N] points avant de finaliser la review :

1. [path:line] — <résumé du finding> — <option A vs option B>
2. [path:line] — ...

Pour chaque point : A, B, ou autre réponse libre.
```

Ne jamais poser plusieurs questions séparées. Une seule pass.

### 6. Écrire le verdict

Produire `briefs/<task>-review.json` :

```json
{
  "task": "<task-slug>",
  "date": "<ISO-8601>",
  "status": "GO|NO-GO",
  "auto_fixes_applied": [
    {
      "path": "file.ml",
      "line": 10,
      "category": "dead-code",
      "description": "Removed unused variable `x`"
    }
  ],
  "findings": [
    {
      "severity": "HIGH",
      "confidence": 4,
      "path": "file.ml",
      "line": 42,
      "category": "correctness",
      "summary": "...",
      "evidence": "...",
      "fix": "...",
      "fingerprint": "file.ml:42:correctness",
      "specialist": "reviewer",
      "status": "OPEN|RESOLVED|ACCEPTED"
    }
  ],
  "summary": {
    "critical": 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "auto_fixed": 0
  },
  "no_go_reason": null
}
```

**Statut GO si :** aucun finding CRITICAL ou HIGH OPEN.
**Statut NO-GO si :** au moins un finding CRITICAL ou HIGH OPEN non résolu ni explicitement accepté.

### 7. Gate humain

Présenter un résumé :
```
Review terminée.
Auto-fixes appliqués : <N>
Findings : <N> critical, <N> high, <N> medium, <N> low
Statut : GO ✅ / NO-GO ❌

[Si NO-GO] : résoudre les findings HIGH+ avant de passer à QA.
[Si GO] : prêt pour /roster-qa.
```

## Output Contract

`briefs/<task>-review.json` avec statut GO ou NO-GO et tous les findings documentés.

**Si GO :** `/roster-qa` peut démarrer.
**Si NO-GO :** retour à `/roster-implement` avec les findings OPEN.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-review",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Toute affirmation de couverture doit citer le fichier et la ligne — jamais "probablement"
- "Ça a l'air bien" n'est pas un finding — si c'est bien, ne pas mentionner
- Une seule AskUserQuestion groupée — jamais de questions multiples
- Auto-fixes : vérifier les quality gates après chaque fix
- Les specialists doivent produire des findings JSON — ne pas accepter du texte libre comme output
- Ne pas auto-fix des changements de comportement visible même si < seuil de lignes
