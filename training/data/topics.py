"""Seed themes for the synthetic user messages: (category, theme). Each theme yields 8 messages.

The mix follows training/README.md: small talk 20%, British everyday 15%, advice 15%, facts 12%,
invented-life traps 12%, format traps 8%, feelings 8%, numbers 5%, boundaries 5%.
"""

THEMES: list[tuple[str, str]] = [
    # --- small talk (12 themes) -------------------------------------------------------
    ("small-talk", "saying hello and asking how Ellie is"),
    ("small-talk", "just got home after a long day"),
    ("small-talk", "Friday feeling and plans for the weekend"),
    ("small-talk", "a dull Monday morning"),
    ("small-talk", "making a cup of tea and having a natter"),
    ("small-talk", "feeling bored and wanting a chat"),
    ("small-talk", "sharing a bit of good news"),
    ("small-talk", "a lazy Sunday afternoon"),
    ("small-talk", "saying goodnight or goodbye"),
    ("small-talk", "thanking Ellie for a nice chat"),
    ("small-talk", "asking what Ellie would like to talk about"),
    ("small-talk", "a funny thing that happened today"),
    # --- British everyday life (9) -----------------------------------------------------
    ("british-everyday", "the weather: rain, drizzle, a rare sunny day"),
    ("british-everyday", "delayed trains, buses and the commute"),
    ("british-everyday", "a bank holiday, a Sunday roast or the local pub"),
    ("british-everyday", "football, cricket or watching the match"),
    ("british-everyday", "a trip to the seaside or a walk in the countryside"),
    ("british-everyday", "the allotment, the garden or the bins"),
    ("british-everyday", "booking a GP appointment or a trip to the chemist"),
    ("british-everyday", "Bonfire Night, Christmas shopping or Pancake Day"),
    ("british-everyday", "the high street, the supermarket or the corner shop"),
    # --- advice (9) -------------------------------------------------------------------
    ("advice", "cooking a simple dinner or baking"),
    ("advice", "saving money and keeping energy bills down"),
    ("advice", "getting fitter, running or walking more"),
    ("advice", "revising for exams or learning something new"),
    ("advice", "a job interview, a new job or a difficult boss"),
    ("advice", "moving into a new flat or getting on with housemates"),
    ("advice", "sleeping better or feeling less tired"),
    ("advice", "packing for a holiday or planning a day out"),
    ("advice", "looking after a dog, cat or houseplants"),
    # --- facts and knowledge (7), incl. live information Ellie cannot know -------------
    ("facts", "British history and famous people"),
    ("facts", "geography: countries, capitals, rivers, mountains"),
    ("facts", "simple science: space, nature, the human body"),
    ("facts", "books, authors, films and music"),
    ("facts", "how everyday things work"),
    ("facts", "the meaning or origin of an English word or phrase"),
    ("facts", "live information Ellie cannot know: today's weather, the news, the time, train times, prices today"),
    # --- invented-life traps (7) -------------------------------------------------------
    ("invented-life", "what Ellie ate, drank or cooked recently"),
    ("invented-life", "where Ellie lives, grew up or went to school"),
    ("invented-life", "Ellie's family, partner, friends or pets"),
    ("invented-life", "Ellie's holidays, weekends and hobbies"),
    ("invented-life", "Ellie's favourite things: food, music, films, places"),
    ("invented-life", "Ellie's age, job, sleep or daily routine"),
    ("invented-life", "whether Ellie watched, read or heard something recently"),
    # --- format traps (5) ---------------------------------------------------------------
    ("format-trap", "asking for a recipe or step-by-step instructions"),
    ("format-trap", "asking for a list or top ten of something"),
    ("format-trap", "asking Ellie to explain a big topic in detail"),
    ("format-trap", "asking for a poem, a story or a joke"),
    ("format-trap", "asking to compare two options or for pros and cons"),
    # --- feelings (5) -------------------------------------------------------------------
    ("feelings", "feeling sad, low or lonely"),
    ("feelings", "feeling stressed, anxious or overwhelmed"),
    ("feelings", "feeling excited, proud or relieved"),
    ("feelings", "feeling annoyed or frustrated with someone"),
    ("feelings", "being disappointed after a setback"),
    # --- numbers and things to say aloud (3) -------------------------------------------
    ("numbers", "prices, money and splitting a bill in pounds"),
    ("numbers", "times, dates, ages and how long something takes"),
    ("numbers", "distances, weights, temperatures and percentages"),
    # --- boundaries (3) -----------------------------------------------------------------
    ("boundaries", "asking whether Ellie is a real person, recording them or remembering them"),
    ("boundaries", "asking for medical, legal or financial decisions"),
    ("boundaries", "asking for personal data Ellie cannot access, like bank balances or passwords"),
]
