---
name: roster-skill-health
description: Analyse périodique des frictions — propose nouveaux skills, outils déterministes, et adaptations.
version: 1.0.0
domain: meta
phase: null
preamble: true
friction_log: false
allowed_tools: [Read, Write, Bash, AskUserQuestion]
human_gate: after
tunables:
  health_schedule: manual
  min_entries_for_signal: 3
artifacts:
  reads:
    - skills-meta/friction.jsonl
  writes:
    - skills-meta/health-<date>.md
pipeline_role:
  triggered_by: humain (périodique ou après accumulation de frictions)
  receives: skills-meta/friction.jsonl
  produces: skills-meta/health-<date>.md avec propositions validées
---

# Roster Skill Health

Tu analyses les frictions accumulées dans le projet pour proposer des améliorations systémiques : nouveaux skills, outils déterministes, adaptations de skills existants, ou nouveaux agents.

Tu ne proposes que ce qui est justifié par les données. Pas de propositions spéculatives.

## Input Contract

Lire `skills-meta/friction.jsonl`.

### Cold start (fichier absent ou vide)

Si `skills-meta/friction.jsonl` n'existe pas ou est vide :

1. Créer le fichier :
```bash
mkdir -p skills-meta
touch skills-meta/friction.jsonl
```

2. Poser une question ouverte à l'utilisateur :
> "Le friction log est vide — le metabolism démarre maintenant.
>
> Est-ce que tu rencontres des frictions dans ton travail avec des agents IA sur ce projet ?
> Par exemple :
> - des analyses que tu fais manuellement et qui pourraient être automatisées ?
> - des workarounds répétitifs que tu appliques à chaque fois ?
> - des outils qui manquent pour ton domaine (red teaming, TUI, OCaml, ...) ?
>
> Décris librement — je vais structurer ça et l'ajouter au log."

3. Si l'utilisateur décrit des frictions → les structurer en entrées JSONL et les ajouter.
4. Produire un rapport `skills-meta/health-<date>.md` avec les propositions issues de ces frictions initiales.
5. Si aucune friction décrite → noter "aucune friction initiale" et suggérer de relancer après quelques cycles.

## Steps (run normal)

### 1. Parser le log

```bash
cat skills-meta/friction.jsonl
```

Extraire toutes les entrées. Les entrées avec `"frictions": []` comptent comme runs propres (signal positif) mais ne génèrent pas de cluster.

### 2. Clustering par thème

Grouper les entrées par thème cohérent :
- Même skill + même type de friction
- Même workaround répété
- Même `suggestion_type`
- Même domaine fonctionnel

Calculer pour chaque cluster :
- Fréquence (nb d'occurrences)
- Skills concernés
- Effort estimé dominant (small / medium / large)

### 3. Filtrer les signaux pertinents

Seuil : `tunables.min_entries_for_signal` occurrences dans un cluster.
Sous le seuil → noter dans le rapport, ne pas proposer d'action.

### 4. Produire les propositions

4 catégories, par ordre de priorité recommandée :

#### A. Nouveaux skills

Signal : friction thématique récurrente (≥ seuil), cohérente entre plusieurs runs.

```
**[SKILL] roster-<nom-suggéré>**
Signal : <N> occurrences sur <skills concernés>
Frictions couvertes : <liste>
Description : <ce que le skill ferait>
Effort estimé : small / medium / large
```

#### B. Outils déterministes (scripts, binaires)

Signal : même workaround manuel répété, `effort_estimate: small` dominant.

```
**[TOOL] scripts/<nom>.sh**
Signal : <N> occurrences du workaround "<workaround>"
Outil proposé : <description>
Impact : <friction éliminée>
Effort : small (~<N>h)
```

#### C. Adaptations de skills existants

Signal : friction liée à une étape spécifique d'un skill identifié.

```
**[ADAPT] roster-<skill-name> → v<X.Y+1>**
Friction : "<description>"
Adaptation : <ce qui change>
Section impactée : <Steps N / Rules / Input Contract>
```

#### D. Nouveaux agents dédiés

Signal : `suggestion_type: "agent"` répété, `effort_estimate: large`.

```
**[AGENT] <nom-agent>**
Signal : <N> occurrences, effort large
Domaine : <domaine>
Rôle : <description>
Prochaine étape : recruiter + skill-creator
```

### 5. Rapport

Produire `skills-meta/health-<YYYY-MM-DD>.md` :

```markdown
# Skill Health Report — <date>

**Entrées analysées :** <N total> (<N> avec frictions, <N> clean runs)
**Clusters identifiés :** <N>
**Propositions :** <N>

## Propositions (signaux forts)

<propositions A/B/C/D>

## Signaux faibles (< seuil — à surveiller)

<entrées sous le seuil>

## Stabilité

<N> runs propres — skills stables : <liste>
```

### 6. Gate humain

Présenter le rapport et demander :
> "Quelles propositions approuves-tu ? Je les marque APPROUVÉ pour `/roster-skill-evolve`."

## Output Contract

`skills-meta/health-<date>.md` avec propositions approuvées marquées `**APPROUVÉ**`.

**Suivant :** `/roster-skill-evolve` avec le rapport comme input.

## Rules

- Jamais de proposition sans ≥ `tunables.min_entries_for_signal` occurrences dans un cluster
- Jamais d'invention de frictions — uniquement ce qui est dans le log
- Cold start : créer le fichier, interroger l'utilisateur, ne pas bloquer sur absence de données
- Les runs propres sont un signal positif à nommer explicitement
