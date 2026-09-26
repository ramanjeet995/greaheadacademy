"""Write a new Gearhead Academy system with Claude and add it to public/systems.json.

Content is generated once, offline, so every visitor reads it for free.
Always review a draft before publishing it.

Usage:
    pip install anthropic
    set ANTHROPIC_API_KEY=sk-ant-...        (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
    python tools/generate_system.py mechanical "Bicycle gears"
    python tools/generate_system.py electromechanical "3D printer" --publish

Without --publish the draft is saved to tools/drafts/<id>.json for review (edit it freely), then:
    python tools/generate_system.py mechanical "Bicycle gears" --publish-draft
"""
import argparse
import json
import re
import sys
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parent.parent
SYSTEMS_FILE = ROOT / "public" / "systems.json"
DRAFTS = ROOT / "tools" / "drafts"

PROMPT = """Build a guided-discovery lesson for {field} engineers on the system "{name}".
It is method-driven: NO numbers, formulas or calculations — only which parts, how they connect and move,
why designs are chosen, what goes wrong, and how the design evolved. Use real engineering history and
real component names. Be accurate; if unsure of an exact date, give an approximate era.
Weapons and military systems are fine at the level of how the mechanism works and how it evolved
(like a museum or encyclopedia) — never construction steps, materials, dimensions, recipes, explosive or
propellant chemistry, or ways to modify a weapon or defeat safety or legal controls.

Write exactly 5 layers, going deeper and from older to modern solutions:
1 (Student): the basic layout — the parts and how they connect.
2 (Junior): the core mechanism — which mechanism, how it moves, the alternatives.
3 (Mid-level): refinement — geometry, feel, wear, what goes wrong.
4 (Senior): assistance and safety — making it work in the real world.
5 (Modern): what engineers build today.

Each layer after the first opens with a question: a concrete scenario that exposes the limit of the
previous layer and asks the learner how they'd solve it. Layer 1 has no question (the starting prompt is it).

Reply with only JSON, no prose:
{{"title": "short name", "era": "e.g. 1900s → today",
  "prompt": "the starting question: a concrete situation, then 'How would you make it work? Describe the parts, how they connect and how they move.'",
  "hints": ["hint 1 for the starting question", "hint 2"],
  "layers": [
    {{"name": "short layer name", "real": "2–3 sentences: how real designs do it at this layer"}},
    {{"name": "...", "ask": "the question that opens this layer", "real": "..."}},
    {{"name": "...", "ask": "...", "real": "..."}},
    {{"name": "...", "ask": "...", "real": "..."}},
    {{"name": "...", "ask": "...", "real": "..."}}
  ]}}"""


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]


def extract_json(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        a, b = text.find("{"), text.rfind("}")
        if a < 0 or b <= a:
            raise
        return json.loads(text[a : b + 1])


def validate(data):
    problems = []
    for key in ("title", "era", "prompt", "hints", "layers"):
        if not data.get(key):
            problems.append(f"missing {key}")
    layers = data.get("layers") or []
    if len(layers) != 5:
        problems.append(f"expected 5 layers, got {len(layers)}")
    for i, layer in enumerate(layers):
        if not layer.get("name") or not layer.get("real"):
            problems.append(f"layer {i + 1} missing name/real")
        if i > 0 and not layer.get("ask"):
            problems.append(f"layer {i + 1} missing ask")
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("field", choices=["mechanical", "electromechanical"])
    parser.add_argument("name", help='e.g. "Bicycle gears"')
    parser.add_argument("--publish", action="store_true", help="add straight to public/systems.json")
    parser.add_argument("--publish-draft", action="store_true", help="publish the reviewed draft in tools/drafts without calling Claude")
    args = parser.parse_args()

    systems = json.loads(SYSTEMS_FILE.read_text(encoding="utf-8"))
    sys_id = slug(args.name)
    if any(s["id"] == sys_id for s in systems):
        sys.exit(f'A system with id "{sys_id}" already exists.')

    if args.publish_draft:
        draft = DRAFTS / f"{sys_id}.json"
        if not draft.exists():
            sys.exit(f"No draft at {draft.relative_to(ROOT)}. Generate one first.")
        entry = json.loads(draft.read_text(encoding="utf-8"))
        problems = validate(entry)
        if problems:
            sys.exit("The draft didn't pass checks: " + "; ".join(problems))
        systems.append(entry)
        SYSTEMS_FILE.write_text(json.dumps(systems, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Published {sys_id}. Deploy to make /s/{sys_id} live.")
        return

    client = anthropic.Anthropic()
    print(f"Writing '{args.name}' ({args.field})…")
    response = client.beta.messages.create(
        model="claude-opus-5",
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # if Opus declines, the API retries on Anthropic's recommended fallback model
        messages=[{"role": "user", "content": PROMPT.format(field=args.field, name=args.name)}],
    )
    if response.stop_reason == "refusal":
        sys.exit("Claude declined to write this one. Try a different system name.")
    text = "".join(block.text for block in response.content if block.type == "text")
    data = extract_json(text)
    problems = validate(data)
    if problems:
        sys.exit("The draft didn't pass checks: " + "; ".join(problems))

    entry = {
        "id": sys_id,
        "field": args.field,
        "title": data["title"],
        "era": data["era"],
        "prompt": data["prompt"],
        "hints": data["hints"][:2],
        "layers": [
            {k: layer[k] for k in ("name", "ask", "real") if k in layer and (k != "ask" or i > 0)}
            for i, layer in enumerate(data["layers"])
        ],
    }
    usage = response.usage
    print(f"Tokens: {usage.input_tokens} in / {usage.output_tokens} out")

    if args.publish:
        systems.append(entry)
        SYSTEMS_FILE.write_text(json.dumps(systems, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Added to {SYSTEMS_FILE.relative_to(ROOT)}. Deploy to publish /s/{sys_id}.")
    else:
        DRAFTS.mkdir(parents=True, exist_ok=True)
        out = DRAFTS / f"{sys_id}.json"
        out.write_text(json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Draft saved to {out.relative_to(ROOT)}. Review it, then run again with --publish-draft.")


if __name__ == "__main__":
    main()
