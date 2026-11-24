"""Generate Persian audio for every lesson item (anything with both "fa" and "audio").

Setup (once):  python3 -m venv .venv && .venv/bin/pip install edge-tts
Usage (a step may set "voice": "farid" or "dilara" to override --voice):
    .venv/bin/python scripts/generate_audio.py            # only missing files
    .venv/bin/python scripts/generate_audio.py --force    # regenerate all
    .venv/bin/python scripts/generate_audio.py --voice farid
    .venv/bin/python scripts/generate_audio.py --sample   # compare both voices -> samples/index.html
"""
import asyncio, glob, json, os, sys

import edge_tts

VOICES = {"dilara": "fa-IR-DilaraNeural", "farid": "fa-IR-FaridNeural"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Z = "‌"


def items():
    """Yield (audio_id, persian) for every dict that has both keys, in any lesson file."""
    def walk(o):
        if isinstance(o, dict):
            if o.get("audio") and o.get("fa"):
                yield o["audio"], o["fa"], o.get("voice")
            for v in o.values():
                yield from walk(v)
        elif isinstance(o, list):
            for v in o:
                yield from walk(v)
    for path in sorted(glob.glob(os.path.join(ROOT, "lessons", "*.json"))):
        with open(path, encoding="utf-8") as f:
            yield from walk(json.load(f))


async def save(text, voice, path, rate="+0%"):
    await edge_tts.Communicate(text, voice, rate=rate).save(path)


async def sample():
    phrases = [
        ("mikhām beram", "می" + Z + "خوام برم"),
        ("nemikhām biyām", "نمی" + Z + "خوام بیام"),
        ("nemitūnam injā bokhoram", "نمی" + Z + "تونم اینجا بخورم"),
        ("mitūnam beram", "می" + Z + "تونم برم"),
    ]
    out = os.path.join(ROOT, "samples")
    os.makedirs(out, exist_ok=True)
    rows = []
    for i, (fin, fa) in enumerate(phrases, 1):
        for name, voice in VOICES.items():
            fn = f"{i}-{name}.mp3"
            await save(fa, voice, os.path.join(out, fn))
            rows.append(f"<tr><td dir='rtl' style='font-size:1.6em'>{fa}</td><td>{fin}</td>"
                        f"<td>{name}</td><td><audio controls src='{fn}'></audio></td></tr>")
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write("<meta charset='utf-8'><title>Voice samples</title>"
                "<table cellpadding=8>" + "".join(rows) + "</table>")
    print("Open samples/index.html and compare.")


async def main():
    if "--sample" in sys.argv:
        return await sample()
    force = "--force" in sys.argv
    name = sys.argv[sys.argv.index("--voice") + 1] if "--voice" in sys.argv else "dilara"
    voice = VOICES[name]
    out = os.path.join(ROOT, "audio")
    os.makedirs(out, exist_ok=True)
    todo = [(i, t, v) for i, t, v in items() if force or not os.path.exists(os.path.join(out, f"{i}.mp3"))]
    print(f"Generating {len(todo)} clips with {voice}")
    failed = []
    for audio_id, text, step_voice in todo:
        path = os.path.join(out, f"{audio_id}.mp3")
        try:
            await save(text, VOICES.get(step_voice, voice), path)
            print(f"Saved [{audio_id}]: {text}")
        except Exception as e:
            failed.append(audio_id)
            if os.path.exists(path) and os.path.getsize(path) == 0:
                os.remove(path)
            print(f"Failed [{audio_id}]: {e}")
    print(f"\nDone! {len(failed)} failed: {failed}" if failed else "\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
