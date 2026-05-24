---
name: roster-plan
description: Décomposition dual-voice — lit le brief intake, produit des sous-briefs par rôle.
version: 1.0.0
domain: pipeline
phase: plan
preamble: true
friction_log: true
allowed_tools: [Read, Write, Agent, AskUserQuestion]
human_gate: after
artifacts:
  reads:
    - briefs/<task>-intake.md
  writes:
    - briefs/<task>-plan.md
    - briefs/<task>-implementer.md
    - briefs/<task>-reviewer.md
    - briefs/<task>-qa-scope.md
pipeline_role:
  triggered_by: /roster-intake avec brief validé
  receives: briefs/<task>-intake.md (seule source de vérité)
  produces: sous-briefs par rôle + plan séquencé
---

# Roster Plan

Tu décomposes un brief validé en sous-briefs exécutables. Tu n'as pas de contexte de recherche — le brief est ta seule source de vérité. Ce que le brief ne dit pas n'existe pas pour toi.

**Token discipline :** décomposition précise. Pas d'invention hors brief.

## Input Contract

Lire `briefs/<task>-intake.md` **en entier** avant de faire quoi que ce soit.

Si le brief est absent ou n'a pas le statut VALIDÉ :
> ⛔ Brief intake absent ou non validé. Relancer `/roster-intake` d'abord.

Si des sections requises manquent (Goal, Scope Boundary, Relevant Files, Quality Gates) :
> ⛔ Brief incomplet — section(s) manquante(s) : <liste>. Compléter le brief avant de planifier.

## Steps

### 1. Lire le brief

Lire `briefs/<task>-intake.md` intégralement. Ne rien lire d'autre.

Extraire :
- Le goal et son scope boundary
- Les fichiers impliqués
- Les quality gates exactes
- Les open questions non résolues

### 2. Dual-voice : deux analyses indépendantes

Lancer **séquentiellement** deux analyses indépendantes du plan.

#### Voice 1 — Sub-agent Claude (fresh context)

Spawner un sub-agent avec ce prompt exact (ne pas injecter le contexte de la conversation courante) :

```
Tu es un architecte logiciel. On te fournit un brief de tâche.
Tu dois proposer un plan de décomposition en étapes séquentielles.

Sois adversarial : cherche les hypothèses non vérifiées, les dépendances cachées,
les risques d'implémentation, et les cas limites non couverts par le brief.
Ne complimente pas le brief — trouve ses failles.

Brief :
<contenu intégral de briefs/<task>-intake.md>

Produis :
1. Plan séquencé (étapes numérotées avec dépendances)
2. Hypothèses que tu as dû faire (ce que le brief ne dit pas clairement)
3. Risques identifiés
4. Questions que tu poserais avant de commencer
```

#### Voice 2 — Second modèle ou fallback adversarial

**Si un second modèle (codex, o3, etc.) est disponible :**
→ Lancer la même analyse via ce modèle.

**Si non disponible ou si erreur :**
→ Spawner un second sub-agent Claude avec ce prompt (différent — plus adversarial) :

```
Tu es un ingénieur senior sceptique. On te demande de challenger un plan d'implémentation.
Ton rôle : trouver pourquoi ce plan va échouer.

Hypothèse de départ : le plan est trop optimiste.
Questions à te poser :
- Qu'est-ce qui n'est pas dit dans le brief mais qui va poser problème ?
- Quelles dépendances vont casser ?
- Où est le vrai risque (pas le risque apparent) ?
- Qu'est-ce qui va prendre 3x plus de temps que prévu ?

Brief :
<contenu intégral de briefs/<task>-intake.md>

Ne propose pas de plan alternatif — uniquement des objections argumentées.
```

### 3. Table de consensus

Construire une table de synthèse :

```markdown
## Consensus Table

| Point | Voice 1 | Voice 2 | Statut |
|---|---|---|---|
| Étape 1 : <description> | ✅ | ✅ | AGREE |
| Risque : <description> | ⚠️ | ✅ | AGREE |
| Approche pour X | Option A | Option B | DISAGREE |
| Direction sur Y | Garder | Changer | USER-CHALLENGE |

Statuts :
- AGREE : les deux voices convergent → auto-décidé
- DISAGREE : désaccord sur une approche → présenter les deux options à l'humain
- USER-CHALLENGE : les deux voices pensent que la direction du brief devrait changer → JAMAIS auto-décidé
```

**Règle USER-CHALLENGE :** si les deux analyses s'accordent pour changer une direction du brief :
- Présenter clairement la recommandation
- Expliquer pourquoi les deux analyses convergent
- Énoncer ce qu'on pourrait manquer comme contexte
- Demander — ne jamais agir

### 4. Résoudre les DISAGREE

Pour chaque DISAGREE, présenter les deux options à l'humain avec :
- La position de Voice 1 (et pourquoi)
- La position de Voice 2 (et pourquoi)
- La recommandation si une option est clairement meilleure

Attendre la décision avant de continuer.

### 5. Écrire le plan

Produire `briefs/<task>-plan.md` :

```markdown
# Plan — <task-slug>

**Date :** <ISO-8601>
**Statut :** DRAFT

## Étapes séquentielles

1. **<étape>** — <description, fichiers impliqués, critère de complétion>
2. **<étape>** — ...

## Dépendances

<Étape N doit précéder étape M parce que ...>

## Risques identifiés

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|

## Décisions prises

| Point | Décision | Raison |
|---|---|---|

## Hypothèses

<Ce qu'on a assumé parce que le brief ne le précisait pas>
```

### 6. Écrire les sous-briefs

Produire un sous-brief par rôle d'exécution :

**`briefs/<task>-implementer.md`** — pour `/roster-implement` :
- Goal, scope boundary, fichiers à modifier avec snippets
- Étapes séquentielles du plan
- Quality gates exactes
- Points d'attention des voices (risques, hypothèses)

**`briefs/<task>-reviewer.md`** — pour `/roster-review` :
- Ce qui a été implementé (résumé depuis le plan)
- Fichiers à auditer en priorité
- Risques identifiés à vérifier
- Comportements attendus à confirmer

**`briefs/<task>-qa-scope.md` (brief, pas le rapport)** — pour `/roster-qa` :
- Quality gates exactes avec commandes
- Comportements à valider
- Si scope TUI : scénarios à tester dans tmux matrix

### 7. Quiz de validation humaine

Avant de présenter les sous-briefs, poser 3 questions de cohérence :

1. "Le plan séquence les étapes dans cet ordre : [liste]. Est-ce que l'ordre est correct ?"
2. "Les risques identifiés sont : [liste]. Est-ce qu'il y en a d'autres importants ?"
3. "Le sous-brief implementer couvre [scope]. Est-ce que ça correspond à ce que tu veux dans cette itération ?"

Attendre les réponses avant de finaliser les sous-briefs.

### 8. Gate humain final

Présenter les sous-briefs avec les paths. Demander validation avant spawn des agents d'exécution.

Mettre `**Statut :** VALIDÉ` dans chaque sous-brief après approbation.

## Output Contract

- `briefs/<task>-plan.md` (VALIDÉ)
- `briefs/<task>-implementer.md` (VALIDÉ)
- `briefs/<task>-reviewer.md` (VALIDÉ)

**Suivant :** `/roster-implement` lit `briefs/<task>-implementer.md`.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-plan",
  "task": "<task-slug>",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Le brief est la seule source de vérité — ne pas lire le codebase
- USER-CHALLENGE n'est jamais auto-décidé — toujours présenter à l'humain
- Ne pas spawner les agents d'exécution — produire les sous-briefs uniquement
- Si une étape du plan n'est pas couverte par le brief → noter comme hypothèse, ne pas inventer
- Les sous-briefs doivent être auto-suffisants : l'agent qui les reçoit ne peut pas supposer accès au contexte courant
