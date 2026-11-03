"""TradeCatch ads v2 - master script, casting and fictional data.

Everything here is a DRAMATIZATION with a fictional business. No real customer,
testimonial or result is depicted. Product behaviour mirrors the site copy and
docs/CAPABILITY_MATRIX.md (the receptionist is a founder-configured pilot; the
caller's appointment is a REQUEST that the team confirms).
"""
import os, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent            # .../Videos/ads_v2/_source
ADS_DIR = ROOT.parent                              # .../Videos/ads_v2
ASSETS = ROOT / "assets"
VIDEOS = ADS_DIR.parent                            # .../Videos (raw clips live here)
REPO = VIDEOS.parent
# scratch space for intermediates (UI frame cache, per-ad segments); override with ADS_WORK
WORK = Path(os.environ.get("ADS_WORK") or Path(tempfile.gettempdir()) / "tradecatch_ads_work")

FPS = 24
# output formats: 9x16 = Reels / TikTok / Shorts / Stories (masters); 4x5 = Instagram + Facebook feed
FORMATS = {"9x16": (1080, 1920), "4x5": (1080, 1350)}
FMT = "9x16"
W, H = FORMATS[FMT]

def set_format(name):
    """Select the output format for videolib / build_ads (picture only; audio is format-independent)."""
    global FMT, W, H
    if name not in FORMATS: raise ValueError(f"unknown format {name!r}; choose from {sorted(FORMATS)}")
    FMT = name; W, H = FORMATS[name]

# ---- casting (ElevenLabs voice ids) -------------------------------------------------
VOICES = {
    "en": {
        "narr": "iP95p4xoKVk53GoZ742B",   # Chris - Charming, Down-to-Earth
        "recep": "hpp4J3VqNfWAUOO0d1Us",  # Bella - Professional, Bright, Warm
        "custF": "EXAVITQu4vr4xnSDxMaL",  # Sarah - Mature, Reassuring, Confident
        "custM": "TX3LPaxmHKxFdv7VOQHJ",  # Liam
    },
    "fr": {
        "narr": "2dxaXwaYxEEIDjoHj0V4",   # Leo - Gentle and Enthusiastic (Quebec, advertisement)
        "recep": "WW0JfNPk5DgcQdM0d6X6",  # Claudia - Warm, Energetic and Confident (Quebec)
        "custF": "UJCi4DDncuo0VJDSIegj",  # Amelie - Young, Confident and Friendly (Quebec)
        "custM": "vB6a2kqKn8Uola8QAlvL",  # Max - Natural Quebecer
    },
}
# stability: lower = more expressive/natural variation, higher = steadier read
STABILITY = {"narr": 0.5, "recep": 0.55, "custF": 0.4, "custM": 0.33}

# ---- spoken lines -------------------------------------------------------------------
# id -> (role, text).  Roles: narr | recep | custF | custM
LINES = {
    "en": {
        # AD A  "Under the Sink"
        "A_vo1":  ("narr",  "You're under a sink. Your phone's ringing. And you can't answer."),
        "A_vo2":  ("narr",  "That caller isn't leaving a voicemail. They're calling the next plumber."),
        "A_sigh": ("custF", "[sighs] Come on..."),
        "A_vo3":  ("narr",  "Same job. This time, TradeCatch picks up."),
        "A_r1":   ("recep", "Thanks for calling NorthStar Plumbing. How can I help?"),
        "A_c1":   ("custF", "Hi - my kitchen sink is leaking. Do you cover Laval?"),
        "A_r2":   ("recep", "We do. What's your address, and when works best?"),
        "A_c2":   ("custF", "45 Laurier, in Laval. Tomorrow morning, around ten?"),
        "A_r3":   ("recep", "Perfect. I've sent your request to the team. They'll text you to confirm."),
        "A_vo4":  ("narr",  "You stay on the job. TradeCatch answers, and hands you the details."),
        # AD B  "The Ladder"
        "B_vo1":  ("narr",  "You're an electrician. Not a receptionist."),
        "B_vo2":  ("narr",  "Plenty of callers won't leave a voicemail. They'll just call someone else."),
        "B_vo3":  ("narr",  "With TradeCatch, a missed call gets a text back right away, under your company's name."),
        "B_vo4":  ("narr",  "You wrap up the job. The request is already waiting."),
        # AD C  "After Hours"
        "C_vo1":  ("narr",  "Your customers don't stop calling at five."),
        "C_r1":   ("recep", "Thanks for calling NorthStar Plumbing. You've reached us after hours. How can I help?"),
        "C_c1":   ("custM", "My basement is flooding! I need someone right now!"),
        "C_r2":   ("recep", "I understand, this is urgent. I'm connecting you to the on-call technician right now."),
        "C_vo3":  ("narr",  "Real emergencies reach your on-call line. Everything else is waiting in the morning, with a summary."),
        # shared CTA
        "CTA1":   ("narr",  "TradeCatch. Every call counts."),
        "CTA2":   ("narr",  "Book your free audit at trade catch dot C A."),
    },
    "fr": {
        "A_vo1":  ("narr",  "Les mains sous l'évier. Le téléphone qui sonne. Et tu ne peux pas répondre."),
        "A_vo2":  ("narr",  "Ce client-là ne laissera pas de message. Il va appeler le prochain plombier."),
        "A_sigh": ("custF", "[sighs] Ah, voyons donc..."),
        "A_vo3":  ("narr",  "Même chantier. Cette fois, Tréïd Catch décroche."),
        "A_r1":   ("recep", "Merci d'avoir appelé Plomberie NorthStar. Comment puis-je vous aider?"),
        "A_c1":   ("custF", "Bonjour, l'évier de ma cuisine fuit. Vous desservez Laval?"),
        "A_r2":   ("recep", "Oui, nous desservons Laval. Quelle est votre adresse, et quel moment vous conviendrait?"),
        "A_c2":   ("custF", "Au 45, avenue Laurier, à Laval. Demain matin, vers dix heures?"),
        "A_r3":   ("recep", "Parfait. J'ai transmis votre demande à l'équipe. Elle vous écrira pour confirmer."),
        "A_vo4":  ("narr",  "Tu restes sur ton chantier. Tréïd Catch répond, et te remet les détails."),
        "B_vo1":  ("narr",  "Tu es électricien. Pas réceptionniste."),
        "B_vo2":  ("narr",  "Bien des gens ne laissent pas de message. Ils appellent quelqu'un d'autre."),
        "B_vo3":  ("narr",  "Avec Tréïd Catch, un appel manqué reçoit un texto tout de suite, au nom de ton entreprise."),
        "B_vo4":  ("narr",  "Tu termines ta job. La demande est déjà là."),
        "C_vo1":  ("narr",  "Tes clients n'appellent pas seulement de neuf à cinq."),
        "C_r1":   ("recep", "Merci d'avoir appelé Plomberie NorthStar. Nous sommes fermés pour la soirée. Comment puis-je vous aider?"),
        "C_c1":   ("custM", "Mon sous-sol est inondé! J'ai besoin de quelqu'un tout de suite!"),
        "C_r2":   ("recep", "Je comprends, c'est urgent. Je vous transfère immédiatement au technicien de garde."),
        "C_vo3":  ("narr",  "Les vraies urgences rejoignent ta ligne de garde. Le reste est là le matin, avec un résumé."),
        "CTA1":   ("narr",  "Tréïd Catch. Chaque appel compte."),
        "CTA2":   ("narr",  "Réserve ton audit gratuit sur tradecatch point C A."),
    },
}

# ---- on-screen copy (product UI, not subtitles) ---------------------------------------
BRAND = {
    "en": {"tag": "Every call counts.", "cta": "Book a free 20-minute audit", "url": "tradecatch.ca",
           "legal": "Dramatization with a fictional business. Receptionist is a founder-configured pilot."},
    "fr": {"tag": "Chaque appel compte.", "cta": "Réserver un audit gratuit", "url": "tradecatch.ca",
           "legal": "Dramatisation avec une entreprise fictive. La réceptionniste est un pilote configuré par le fondateur."},
}
