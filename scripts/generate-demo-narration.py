"""Generate the approved bilingual demo narration MP3s with edge-tts.

Keep this text exactly in sync with NARRATION in
src/components/demo-video/timeline.ts. After regenerating, run
`node scripts/measure-narration.mjs` and the repository media check. The approved
77-second EN and 89-second FR windows may stay longer than the measured minimum,
but every clip must fit its scene before replacement videos are exported.
"""
import asyncio
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1] / "public" / "demo-video" / "narration"
TTS_RATES = {"en": "+15%", "fr": "+35%"}
# Dense English proof/disclaimer scenes need a little more pace to stay inside
# their approved timeline windows without clipping.
TTS_RATE_OVERRIDES = {
    ("en", 2): "+23%",
    ("en", 5): "+50%",
    ("en", 6): "+31%",
    ("en", 7): "+38%",
}

NARRATION = {
    "en": {
        1: "You already paid to make the phone ring. But when you are working, you cannot always answer.",
        2: "In a controlled pilot, TradeCatch texts back within seconds, under your company's name. The customer stays engaged instead of calling your competitor.",
        3: "It collects the customer's name, problem, urgency, address, and a photo while you stay on the job. When you check your phone, the lead is already qualified.",
        4: "The right technician receives one clear job summary. They can accept, decline, or call; a backup can be alerted if no one responds.",
        5: "Acceptance notifies the customer. Entitled, linked Growth pilot organizations book in-app—without native Google or Outlook sync.",
        6: "Starter pilots can follow up on quotes on days 1, 3, 7, and 14. A reply stops the sequence; the pipeline is only for entitled, linked Growth pilot organizations.",
        7: "Figures are illustrative, not promised results. Workspaces show linked-organization data only—not self-serve SaaS or native two-way CRM.",
        8: "Stop losing jobs when you cannot answer. Get your free missed-opportunity audit with TradeCatch.",
    },
    "fr": {
        1: "Vous avez déjà payé pour faire sonner le téléphone. Mais quand vous travaillez, vous ne pouvez pas toujours répondre.",
        2: "Dans un pilote contrôlé, TradeCatch renvoie un texto en quelques secondes, au nom de votre entreprise. Le client reste engagé au lieu d'appeler votre concurrent.",
        3: "Le système recueille le nom du client, le problème, l'urgence, l'adresse et une photo pendant que vous poursuivez le travail. Quand vous regardez votre téléphone, la demande est déjà qualifiée.",
        4: "Le bon technicien reçoit une fiche d'intervention claire. Il peut accepter, refuser ou appeler. Un remplaçant peut être alerté si personne ne répond.",
        5: "L'acceptation avise le client. Les organisations pilotes Growth admissibles et liées réservent dans l'espace; Google et Outlook ne sont pas synchronisés nativement.",
        6: "Les pilotes Starter relancent les soumissions aux jours 1, 3, 7 et 14. Une réponse met fin à la séquence; le pipeline est réservé aux organisations pilotes Growth admissibles et liées.",
        7: "Les chiffres sont illustratifs, sans promesse de résultats. L'espace montre seulement les données de l'organisation liée, sans SaaS en libre-service ni CRM bidirectionnel natif.",
        8: "Ne perdez plus de contrats parce que vous ne pouvez pas répondre. Obtenez votre audit gratuit des opportunités manquées avec TradeCatch.",
    },
}

VOICES = {"en": "en-US-AndrewNeural", "fr": "fr-CA-AntoineNeural"}


async def main() -> None:
    for loc, scenes in NARRATION.items():
        out_dir = ROOT / loc
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, text in scenes.items():
            path = out_dir / f"scene-{i}.mp3"
            communicate = edge_tts.Communicate(
                text,
                VOICES[loc],
                rate=TTS_RATE_OVERRIDES.get((loc, i), TTS_RATES[loc]),
                pitch="-2Hz",
            )
            await communicate.save(str(path))
            print(f"saved {path}")


if __name__ == "__main__":
    asyncio.run(main())
