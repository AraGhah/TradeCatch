"""Generate bilingual demo narration MP3s with edge-tts.

Keep the text in sync with NARRATION in src/components/demo-video/timeline.ts.
After regenerating, run `node scripts/measure-narration.mjs` and copy the
suggested scene durations back into SCENE_DURATIONS_SEC.
"""
import asyncio
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1] / "public" / "demo-video" / "narration"

NARRATION = {
    "en": {
        1: "You already paid to make the phone ring. But when you are working, you cannot always answer.",
        2: "Trade Catch answers within seconds, under your company's name. The customer stays engaged instead of calling your competitor.",
        3: "It collects the problem, the urgency, the address and a photo, while you stay focused on the job. By the time you check your phone, the lead is already qualified.",
        4: "You receive one clear opportunity summary. No long message thread to review. You immediately know who needs your attention first.",
        5: "Accept the job and the appointment is confirmed. Your customer is kept informed without you touching a keyboard.",
        6: "Trade Catch also follows up on unanswered estimates, bringing forgotten opportunities back to your attention. You already invested time preparing that estimate.",
        7: "Every week you see what was recovered, booked and reactivated. No more guessing whether your follow-up is working.",
        8: "Stop losing jobs when you cannot answer. Get your free missed-opportunity audit with Trade Catch.",
    },
    "fr": {
        1: "Vous avez déjà payé pour faire sonner le téléphone. Mais quand vous travaillez, vous ne pouvez pas toujours répondre.",
        2: "Trade Catch répond en quelques secondes, au nom de votre entreprise. Le client reste engagé au lieu d'appeler votre concurrent.",
        3: "Le système recueille le problème, l'urgence, l'adresse et une photo, pendant que vous restez concentré sur le travail. Quand vous regardez votre téléphone, la demande est déjà qualifiée.",
        4: "Vous recevez un seul résumé clair. Aucune longue conversation à relire. Vous savez quel client rappeler en priorité.",
        5: "Confirmez l'intervention, et le client reçoit immédiatement son rendez-vous. Tout se fait sans que vous touchiez à un clavier.",
        6: "Trade Catch relance aussi vos soumissions restées sans réponse. Vous avez déjà investi du temps à préparer ces soumissions, et le système évite qu'elles soient simplement oubliées.",
        7: "Chaque semaine, vous voyez ce qui a été récupéré, réservé et réactivé. Vous savez enfin si vos relances produisent des résultats.",
        8: "Ne perdez plus de contrats parce que vous ne pouvez pas répondre. Obtenez votre audit gratuit des opportunités manquées avec Trade Catch.",
    },
}

VOICES = {"en": "en-US-AndrewNeural", "fr": "fr-CA-AntoineNeural"}


async def main() -> None:
    for loc, scenes in NARRATION.items():
        out_dir = ROOT / loc
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, text in scenes.items():
            path = out_dir / f"scene-{i}.mp3"
            communicate = edge_tts.Communicate(text, VOICES[loc], rate="-2%", pitch="-2Hz")
            await communicate.save(str(path))
            print(f"saved {path}")


if __name__ == "__main__":
    asyncio.run(main())
