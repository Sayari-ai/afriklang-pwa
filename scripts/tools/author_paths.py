"""Author paths 2-20 of the catalogue.

We hand-curate 20 distinct prompt sets per theme (one slot per path) so
that no two paths ever share a prompt, while every path still walks the
same 8-theme curriculum at the same difficulty curve (3,4,5,6,7,6,5,4).

Run:
    python tools/author_paths.py \\
        --in  ../docs/content/paths_catalogue.csv \\
        --out ../docs/content/paths_catalogue.csv

Path 1 rows already in the input CSV are preserved verbatim. Paths 2-20
are appended (or replaced if already present).
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

# 8 themes in fixed order, with their level_id and questions-per-level.
THEMES = [
    ("Food",         1, 3),
    ("Body",         2, 4),
    ("Family",       3, 5),
    ("Market",       4, 6),
    ("Daily",        5, 7),
    ("Weather",      6, 6),
    ("Celebration",  7, 5),
    ("Storytelling", 8, 4),
]

# 20 prompts per theme. Index 0 belongs to path 1, index 19 to path 20.
# Path 1's prompts mirror what's already authored in paths_catalogue.csv;
# we re-emit them so this tool can also regenerate the whole file.
PROMPTS: dict[str, list[str]] = {
    "Food": [
        # 3 prompts each
        "A ripe yellow mango on a wooden table",
        "A bowl of white rice",
        "A loaf of fresh bread",

        "A bunch of green plantains",
        "A plate of jollof rice",
        "A cup of black coffee",

        "A red tomato sliced in half",
        "A pot of bubbling stew",
        "A single boiled egg on a plate",

        "A pile of roasted peanuts",
        "A bowl of fresh fruit salad",
        "A glass of orange juice",

        "A piece of grilled fish on a plate",
        "A bowl of pepper soup",
        "A wedge of watermelon",

        "A stack of pancakes with honey",
        "A bowl of millet porridge",
        "A plate of fried plantains",

        "A roasted yam on a plate",
        "A bowl of okra soup",
        "A glass of cold milk",

        "A piece of chocolate cake",
        "A bowl of attiéké",
        "A grilled chicken leg",

        "A handful of dates",
        "A plate of fufu and soup",
        "A cup of ginger tea",

        "A bunch of red chili peppers",
        "A bowl of beans porridge",
        "A roasted corn on the cob",

        "A piece of suya on a stick",
        "A bowl of fresh yogurt",
        "A plate of injera with stew",

        "A bowl of egusi soup",
        "A handful of cashew nuts",
        "A cup of bissap juice",

        "A roasted goat skewer",
        "A bowl of pap with akara",
        "A slice of pineapple",

        "A plate of kenkey and fish",
        "A bowl of light soup",
        "A cup of zobo drink",

        "A bowl of waakye",
        "A piece of meat pie",
        "A glass of palm wine",

        "A plate of mafe with rice",
        "A bowl of pounded yam",
        "A cup of baobab juice",

        "A plate of thieboudienne",
        "A bowl of groundnut soup",
        "A cup of tamarind drink",

        "A plate of yassa chicken",
        "A bowl of cassava leaves",
        "A glass of fresh coconut water",

        "A plate of ndolé",
        "A bowl of fonio with fish",
        "A cup of hibiscus tea",

        "A plate of poulet braisé",
        "A bowl of kelewele",
        "A cup of millet drink",
    ],
    "Body": [
        # 4 prompts each
        "A person's right hand showing the palm",
        "A close-up of a smiling mouth",
        "A child's bare foot",
        "A pair of brown human eyes",

        "A clenched fist held up high",
        "A pair of laughing lips",
        "A foot wearing a sandal",
        "A pair of dark eyes looking sideways",

        "A hand giving a thumbs up",
        "A face with closed eyes",
        "A foot stepping on sand",
        "A pair of eyes peering over glasses",

        "Two hands clapping together",
        "A nose with a small piercing",
        "A foot kicking a ball",
        "A pair of green eyes",

        "A hand waving hello",
        "A wide open mouth laughing",
        "A foot resting on a stool",
        "A pair of tired sleepy eyes",

        "A hand pointing forward",
        "An ear with an earring",
        "A pair of feet in running shoes",
        "A pair of eyes wearing eyeliner",

        "A hand holding a pencil",
        "A small chin with a dimple",
        "A foot covered in mud",
        "A pair of eyes squinting in sunlight",

        "A hand washing under tap water",
        "A face with painted cheeks",
        "A foot soaking in a basin",
        "A pair of curious wide eyes",

        "A hand wearing a wedding ring",
        "A forehead with beads of sweat",
        "A foot wrapped in a bandage",
        "A pair of focused reading eyes",

        "A hand holding a phone",
        "A neck with a beaded necklace",
        "A foot on a bicycle pedal",
        "A pair of eyes behind sunglasses",

        "A hand stirring a pot",
        "A shoulder with a tattoo",
        "A foot stepping into water",
        "A pair of newborn baby eyes",

        "A hand cracking an egg",
        "A back covered in a colorful shirt",
        "A foot on a yoga mat",
        "A pair of eyes peeking through a door",

        "A hand braiding hair",
        "A knee bandaged with cloth",
        "A foot dancing on grass",
        "A pair of eyes tearing up",

        "A hand picking up a coin",
        "An elbow leaning on a table",
        "A foot in a flip-flop",
        "A pair of eyes under a hat",

        "A hand patting a dog",
        "A wrist wearing many bracelets",
        "A foot stepping out of a car",
        "A pair of eyes lit by candlelight",

        "A hand holding a passport",
        "An arm flexing its bicep",
        "A foot beside a soccer ball",
        "A pair of eyes through a window",

        "A hand pouring water from a kettle",
        "A jaw chewing food",
        "A foot in a school shoe",
        "A pair of eyes during a phone call",

        "A hand carrying a child",
        "A throat singing into a microphone",
        "A foot beside a fishing net",
        "A pair of eyes reading a book",

        "A hand counting money",
        "A finger tapping a keyboard",
        "A foot stepping over a rope",
        "A pair of eyes during sunset",

        "A hand opening a door",
        "A tongue tasting a spoon",
        "A foot on a wooden floor",
        "A pair of eyes shielded by a hand",
    ],
    "Family": [
        # 5 prompts each
        "A mother holding her baby",
        "A grandfather sitting with a grandchild",
        "Two sisters laughing together",
        "A father teaching his son to ride a bike",
        "A family eating dinner around a table",

        "A grandmother braiding a girl's hair",
        "Two brothers playing chess",
        "A mother feeding her toddler",
        "A father carrying his daughter on shoulders",
        "A family taking a group photo",

        "A grandfather telling stories to grandchildren",
        "A mother and daughter cooking together",
        "Two cousins splashing in water",
        "A father reading a book to his children",
        "A family watching the sunset",

        "A grandmother knitting beside her grandchild",
        "Two brothers helping their mother carry bags",
        "A father holding a newborn",
        "A mother and son walking to school",
        "A family planting a tree together",

        "A grandfather teaching a grandchild to fish",
        "Two sisters sharing a snack",
        "A mother combing her daughter's hair",
        "A father and son fixing a bike",
        "A family praying together",

        "A grandmother and grandson baking bread",
        "Two siblings sharing one umbrella",
        "A mother carrying twin babies",
        "A father lifting his child in the air",
        "A family gathered around a campfire",

        "A grandfather walking with a cane and grandchild",
        "Two sisters writing a letter together",
        "A mother kissing her child's forehead",
        "A father and daughter painting a wall",
        "A family decorating a house for a holiday",

        "A grandmother sweeping with her grandchild",
        "Two brothers sharing earbuds",
        "A mother breastfeeding her baby",
        "A father carrying groceries with his kids",
        "A family playing a board game",

        "A grandfather teaching a grandchild to write",
        "Two sisters trying on clothes",
        "A mother soothing a crying baby",
        "A father showing his son a watch",
        "A family arriving at the airport",

        "A grandmother and grandson tending plants",
        "Two cousins running in the rain",
        "A mother teaching her child to count",
        "A father pushing a stroller",
        "A family unpacking after moving home",

        "A grandfather and grandchild fixing a radio",
        "Two sisters making each other laugh",
        "A mother and son shopping at a market",
        "A father and child flying a kite",
        "A family sitting on a porch",

        "A grandmother handing her grandchild a coin",
        "Two brothers wrestling on a mat",
        "A mother giving medicine to her child",
        "A father carrying his sleeping daughter",
        "A family celebrating a birthday",

        "A grandfather watching grandchildren play football",
        "Two sisters reading the same book",
        "A mother washing her child's hands",
        "A father showing his son how to tie a tie",
        "A family attending a wedding",

        "A grandmother passing a tray of food",
        "Two cousins drawing on the ground",
        "A mother teaching her daughter to dance",
        "A father teaching his son to fish",
        "A family lighting candles together",

        "A grandfather pointing at a photo album",
        "Two siblings building a sandcastle",
        "A mother helping her child do homework",
        "A father and child carrying a basket",
        "A family decorating a Christmas tree",

        "A grandmother offering tea to her grandchild",
        "Two brothers riding the same bicycle",
        "A mother and child shopping for shoes",
        "A father and son washing a car",
        "A family at a graduation ceremony",

        "A grandfather watching the news with grandchildren",
        "Two sisters playing dress-up",
        "A mother teaching her daughter to cook",
        "A father teaching his son to drive",
        "A family at a religious service",

        "A grandmother folding laundry with her grandchild",
        "Two cousins arm wrestling",
        "A mother carrying her baby in a wrap",
        "A father reading a newspaper with his son",
        "A family at the beach",

        "A grandfather playing the harmonica for grandchildren",
        "Two sisters posing in front of a mirror",
        "A mother helping her child put on shoes",
        "A father lifting his child onto a horse",
        "A family roasting marshmallows",

        "A grandmother chopping vegetables with her grandchild",
        "Two siblings laughing on a swing",
        "A mother holding her child's hand at a crosswalk",
        "A father holding his child up to see fireworks",
        "A family hugging in a doorway",
    ],
    "Market": [
        # 6 prompts each
        "A vendor selling tomatoes",
        "A woman carrying a basket on her head",
        "A pile of fresh fish on a market table",
        "A stack of colorful fabrics for sale",
        "A shopkeeper handing change to a customer",
        "A boy carrying groceries home",

        "A man weighing peppers on a scale",
        "A girl helping her mother sell oranges",
        "A row of woven baskets for sale",
        "A vendor cutting watermelon for customers",
        "A boy pushing a wheelbarrow of yams",
        "A woman counting bills at her stall",

        "A vendor pouring rice into a sack",
        "A man holding a live chicken at the market",
        "A row of jewelry on a velvet cloth",
        "A woman bargaining over a price",
        "A boy carrying a tray of bread on his head",
        "A girl tasting a piece of fruit at a stall",

        "A vendor frying fish at the roadside",
        "A man arranging shoes in neat rows",
        "A woman tying up a bundle of greens",
        "A boy chasing a goat through the market",
        "A vendor selling spices in clear jars",
        "A girl holding a colorful kite",

        "A vendor pouring oil into a bottle",
        "A woman sorting beans into piles",
        "A man slicing pineapple with a machete",
        "A row of leather sandals for sale",
        "A boy collecting empty bottles",
        "A girl carrying a chicken under her arm",

        "A vendor stacking onions in a pyramid",
        "A man selling sunglasses from a tray",
        "A woman wrapping fish in newspaper",
        "A row of dried fish on a table",
        "A boy paying with coins at a stall",
        "A girl holding a balloon at the market",

        "A vendor bagging peanuts in plastic",
        "A man fixing a watch at a small stall",
        "A woman carrying firewood on her back",
        "A row of secondhand shoes on cardboard",
        "A boy delivering tea in small glasses",
        "A girl admiring beads at a jewelry stall",

        "A vendor grinding peppers in a mortar",
        "A man selling cassettes from a wooden box",
        "A woman sweeping in front of her stall",
        "A row of clay pots for sale",
        "A boy carrying a sack of charcoal",
        "A girl helping a customer choose a cloth",

        "A vendor pouring palm oil into a jug",
        "A man slicing meat at a butcher stall",
        "A woman fanning charcoal with a flat tray",
        "A row of plastic buckets stacked high",
        "A boy carrying ice in a bucket",
        "A girl holding a chicken egg in each hand",

        "A vendor arranging mangoes in a basket",
        "A man repairing shoes in a corner",
        "A woman selling bread from a glass case",
        "A row of dried herbs hanging from string",
        "A boy collecting trash at the market entrance",
        "A girl trying on a pair of earrings",

        "A vendor mixing cosmetics in a small bowl",
        "A man cutting sugarcane into short sticks",
        "A woman folding fabric on a wooden table",
        "A row of brooms tied together with twine",
        "A boy weighing scrap metal at a stall",
        "A girl carrying a cup of porridge",

        "A vendor dipping akara into hot oil",
        "A man selling phone chargers from a board",
        "A woman braiding straw into mats",
        "A row of toy cars on a blanket",
        "A boy running between stalls with a message",
        "A girl helping her father tie up a sack",

        "A vendor selling soft drinks in a cooler",
        "A man cutting bananas off a stalk",
        "A woman roasting corn over a brazier",
        "A row of belts hanging on a frame",
        "A boy carrying water in a yellow jerrycan",
        "A girl trying on a colorful headwrap",

        "A vendor weighing tomatoes in a metal pan",
        "A man unloading a truck of plantains",
        "A woman pouring beans into a paper cone",
        "A row of plastic flowers in vases",
        "A boy rolling a tire down the road",
        "A girl carrying a small chicken cage",

        "A vendor frying yam slices in a deep pan",
        "A man arranging mobile phones under glass",
        "A woman sewing a hem on her stall",
        "A row of brightly colored buckets",
        "A boy splashing water on a fish to keep it fresh",
        "A girl polishing fruit with a cloth",

        "A vendor stirring a pot of beans",
        "A man calling out prices through a horn",
        "A woman counting eggs into a tray",
        "A row of secondhand books on a mat",
        "A boy carrying a basket of yams on his head",
        "A girl ringing a bell to call customers",

        "A vendor packing rice into small bags",
        "A man selling bicycle parts from a shelf",
        "A woman cracking palm nuts open",
        "A row of wooden masks on display",
        "A boy chasing pigeons away from a grain heap",
        "A girl holding up a printed dress",

        "A vendor wrapping snails in leaves",
        "A man chopping a watermelon in half",
        "A woman shelling peas into a tray",
        "A row of beaded bracelets on a string",
        "A boy collecting pieces of cardboard",
        "A girl handing change to a customer",

        "A vendor weighing dried beans on a small scale",
        "A man pumping air into a balloon",
        "A woman hanging clothes on a line behind her stall",
        "A row of carved wooden bowls",
        "A boy filling bottles with palm oil",
        "A girl helping carry a sack of millet",

        "A vendor mixing groundnut paste in a jar",
        "A man arranging hats on a long pole",
        "A woman sweeping out a stall at the end of the day",
        "A row of plastic toys neatly stacked",
        "A boy locking up a stall with a chain",
        "A girl waving goodbye to customers",
    ],
    "Daily": [
        # 7 prompts each
        "A man brushing his teeth",
        "A woman preparing breakfast",
        "A child walking to school with a backpack",
        "A taxi driving down a busy street",
        "A woman washing clothes by hand",
        "A family watching television in the evening",
        "A man sweeping a courtyard at sunrise",

        "A man shaving in front of a mirror",
        "A woman frying eggs in a pan",
        "A child waiting at a school bus stop",
        "A motorbike weaving through traffic",
        "A man hanging shirts on a clothesline",
        "A family playing cards under a lamp",
        "A woman fetching water from a tap",

        "A man tying his shoelaces",
        "A woman pouring tea into a glass",
        "A child eating breakfast in uniform",
        "A bicycle rider crossing a bridge",
        "A man scrubbing a pot with sand",
        "A family eating dinner by candlelight",
        "A woman sweeping the front steps",

        "A man buttoning his shirt",
        "A woman braiding her own hair",
        "A child finishing homework at a desk",
        "A bus filling with passengers",
        "A man washing a car with a hose",
        "A family reading the newspaper together",
        "A woman feeding chickens in a yard",

        "A man yawning in front of a window",
        "A woman ironing a shirt",
        "A child packing books into a bag",
        "A boda boda picking up a passenger",
        "A man fixing a leaky tap",
        "A family praying before a meal",
        "A woman boiling water on a stove",

        "A man combing his hair",
        "A woman rolling out dough",
        "A child tying their tie for school",
        "A truck unloading goods at a shop",
        "A man mending a torn shirt",
        "A family telling jokes at the table",
        "A woman hanging a baby in a wrap",

        "A man making the bed",
        "A woman pouring rice into a pot",
        "A child polishing school shoes",
        "A car horn-honking in traffic",
        "A man scrubbing the floor with a brush",
        "A family playing music in the living room",
        "A woman counting eggs from a basket",

        "A man drinking coffee from a small cup",
        "A woman slicing onions",
        "A child running to catch a school bus",
        "A van full of vegetables headed to market",
        "A man washing windows with a cloth",
        "A family sitting in a circle on a mat",
        "A woman sweeping a verandah",

        "A man lacing up his boots",
        "A woman milking a goat",
        "A child reciting a lesson aloud",
        "A van delivering bread early in the morning",
        "A man trimming a hedge with shears",
        "A family lighting a kerosene lamp",
        "A woman pounding grain in a mortar",

        "A man sitting on a bench reading a newspaper",
        "A woman lighting a charcoal stove",
        "A child wiping a chalkboard",
        "A donkey cart carrying produce",
        "A man patching a bicycle tire",
        "A family welcoming a guest at the door",
        "A woman folding a baby blanket",

        "A man brushing dust off his shoes",
        "A woman pouring milk into a glass",
        "A child raising a hand in class",
        "A tro tro full of commuters",
        "A man feeding goats in a pen",
        "A family sharing tea on a couch",
        "A woman braiding a daughter's hair",

        "A man closing a metal gate",
        "A woman washing her face at a basin",
        "A child sharpening a pencil",
        "A taxi driver counting fares",
        "A man clearing leaves from a path",
        "A family playing dominoes outdoors",
        "A woman packing food for a journey",

        "A man carrying a briefcase to work",
        "A woman wiping a kitchen counter",
        "A child entering a school gate",
        "A boda boda stopping at a junction",
        "A man washing dishes in a basin",
        "A family fanning themselves on a hot evening",
        "A woman lighting incense in a doorway",

        "A man buckling his belt",
        "A woman setting plates on a table",
        "A child climbing onto a school chair",
        "A van driver checking tires",
        "A man scrubbing a wooden door",
        "A family decorating a room with streamers",
        "A woman shaking out a rug from a balcony",

        "A man drinking a glass of water in the morning",
        "A woman lighting candles after sunset",
        "A child tying their school sash",
        "A bus driver pulling away from a stop",
        "A man trimming a bonsai-like plant",
        "A family arriving home with shopping bags",
        "A woman folding a basket of laundry",

        "A man putting on a wristwatch",
        "A woman boiling milk on a stove",
        "A child sitting cross-legged on a mat",
        "A small motorbike weaving past stalls",
        "A man waxing a wooden table",
        "A family washing a car together",
        "A woman shaking sand out of a sandal",

        "A man putting on a hat by the door",
        "A woman placing fruit in a bowl",
        "A child reading a comic on a step",
        "A taxi waiting at a fuel pump",
        "A man trimming his beard with scissors",
        "A family lifting boxes off a truck",
        "A woman tucking a child into bed",

        "A man drinking water from a clay pot",
        "A woman hanging up a calendar",
        "A child writing on a slate with chalk",
        "A bus conductor calling out routes",
        "A man scrubbing a metal pot until it shines",
        "A family arriving at a restaurant",
        "A woman covering bread dough with a cloth",

        "A man knotting a tie",
        "A woman pouring soup into bowls",
        "A child folding their school uniform",
        "A truck loaded with sacks of grain",
        "A man oiling the chain of a bicycle",
        "A family carrying suitcases out of a house",
        "A woman wiping a baby's hands",

        "A man stretching his arms in a doorway",
        "A woman peeling oranges into a bowl",
        "A child fastening a watch they got as a gift",
        "A taxi driver helping a passenger with bags",
        "A man washing his work clothes outside",
        "A family arriving at church in their best clothes",
        "A woman closing the shutters before bed",
    ],
    "Weather": [
        # 6 prompts each
        "Heavy rain falling on a tin roof",
        "Bright sun over a sandy beach",
        "Dark storm clouds gathering",
        "A rainbow over green hills",
        "Wind blowing through tall grass",
        "Mist rising from a river at dawn",

        "Lightning over a city skyline",
        "Sun setting behind a baobab tree",
        "Hail bouncing off a road",
        "Fog rolling over a mountain",
        "A dust storm sweeping across the desert",
        "Frost forming on a window",

        "Heavy rain on banana leaves",
        "A blue cloudless sky over a field",
        "Snow on a mountain peak",
        "A dramatic sunrise over the savanna",
        "Wind bending palm trees",
        "Drizzle on a quiet street",

        "Storm clouds over the ocean",
        "Sunlight streaming through a forest",
        "Puddles after a heavy downpour",
        "A double rainbow over a lake",
        "Strong wind whipping a flag",
        "Steam rising from wet pavement after rain",

        "A flooded street after heavy rain",
        "A crescent moon in a clear sky",
        "Lightning bolt across a dark sky",
        "Sunset behind a mosque",
        "Fog over a coffee plantation",
        "Wind moving a curtain through an open window",

        "Rain dripping off the edge of a thatched roof",
        "Sunlight glinting off corrugated metal",
        "A clear starry night over a village",
        "Heat haze over a long road",
        "A whirlwind moving across a dry field",
        "A red sky at sunset",

        "A drenched umbrella in a doorway",
        "Sunbeams breaking through clouds",
        "Snow on rooftops in a high town",
        "A pink dawn over rice fields",
        "A breeze moving prayer flags",
        "Smoke from a chimney in cold air",

        "Rain hitting a window pane",
        "Heat shimmering above asphalt",
        "Frost on the grass at dawn",
        "Stars over a desert dune",
        "A wind chime spinning in a storm",
        "Rays of sun through stained glass",

        "Raindrops on a spiderweb",
        "Sunset reflected on water",
        "A cloud shaped like an animal",
        "Sunlight on a dewy field",
        "Wind fluttering newspapers down a street",
        "A lightning storm seen through a window",

        "Steam rising from a hot drink in cold air",
        "Sun rising behind clouds",
        "Dark rainclouds reflected in a river",
        "Fog hiding the tops of buildings",
        "Wind blowing leaves across a square",
        "A halo around the moon",

        "Heavy rain on a market awning",
        "Sunlight cutting through dust in the air",
        "Lightning illuminating a tree",
        "Sunset behind a lone tree on a hill",
        "Wind moving sails on small boats",
        "Snowflakes on someone's coat",

        "Rain pouring through a broken gutter",
        "A bright noon shadow on the ground",
        "A cloud pressed against a mountain",
        "Sunset over a herd of cattle",
        "A breeze ruffling water in a basin",
        "Fog drifting over a fishing dock",

        "Storm clouds over a football pitch",
        "Sun beating down on a market crowd",
        "Hail collecting on a windowsill",
        "Sunset over a railway track",
        "Wind tugging at a clothesline",
        "A cool morning mist on a footpath",

        "A bus driving through pouring rain",
        "A bicycle rider squinting in bright sun",
        "Lightning over a quiet harbor",
        "Sunset reflected on solar panels",
        "A swirl of leaves caught by the wind",
        "A blanket of fog over a tea field",

        "A child jumping in a rain puddle",
        "A man squinting up at the sun",
        "A storm rolling across a flat plain",
        "A red sunset behind chimneys",
        "Wind making a kite dance",
        "Mist drifting over a bridge",

        "A woman shaking water off an umbrella",
        "A boy shielding his eyes from the sun",
        "Storm clouds over fishing boats",
        "Sun rising over a misty river",
        "Wind blowing sand across a road",
        "Fog parting to reveal a hill",

        "A child watching rain through a window",
        "Sun reflecting off a rooftop solar panel",
        "Lightning above a stadium",
        "A pale dawn over a quiet beach",
        "Strong wind tilting a palm tree",
        "Frosty breath in cold morning air",

        "A taxi driver wiping rain from a windscreen",
        "A vendor adjusting an umbrella against the sun",
        "Lightning silhouetting a tree",
        "Pink clouds over a rural road",
        "Wind catching a balloon",
        "A foggy morning at a bus stop",

        "An old woman holding an umbrella in heavy rain",
        "A field worker drinking water under the sun",
        "A storm rolling over a coastal city",
        "Sun rising over a fishing harbor",
        "Wind pushing waves onto a beach",
        "Mist softening a row of houses",

        "Children running for shelter in heavy rain",
        "A lifeguard scanning a sun-drenched beach",
        "A storm churning the surface of a lake",
        "A peaceful sunset behind a windmill",
        "Wind tugging at a straw hat",
        "A foggy valley seen from a hilltop",
    ],
    "Celebration": [
        # 5 prompts each
        "A bride and groom at a wedding",
        "A drummer playing a sabar drum",
        "Children dancing at a festival",
        "A birthday cake with lit candles",
        "Fireworks lighting up a night sky",

        "A couple cutting a wedding cake",
        "A flutist playing at a celebration",
        "Children waving flags at a parade",
        "A grandmother blowing out birthday candles",
        "Sparklers held by friends in the dark",

        "A bride being lifted in a chair",
        "A man playing the kora at a party",
        "Children with painted faces at a carnival",
        "A baby tasting their first birthday cake",
        "Fireworks reflected on a river",

        "A wedding reception under a tent",
        "A band of dancers in matching outfits",
        "Children riding a carousel",
        "A man being congratulated on his graduation",
        "Confetti falling at a stage performance",

        "A bride holding a bouquet of flowers",
        "A drummer leading a procession",
        "Children running with sparklers",
        "A graduation cap being thrown in the air",
        "A streamer-filled birthday party room",

        "A traditional wedding ceremony outdoors",
        "A trumpeter playing in a brass band",
        "Children watching dancers in colorful costumes",
        "A surprise party with friends jumping out",
        "A New Year's countdown crowd",

        "A bride dancing with her father",
        "A guitarist performing at a community event",
        "Children holding balloons at a fair",
        "A team celebrating a championship win",
        "A bonfire surrounded by celebrating friends",

        "A wedding photographer capturing a group",
        "A choir singing at a celebration",
        "Children watching a magic show",
        "A baby's naming ceremony",
        "A street parade with floats",

        "A bride and her bridesmaids posing",
        "A traditional flutist by a fire",
        "Children holding lanterns at night",
        "A senior citizen receiving an award",
        "Fireworks bursting over a temple",

        "A wedding feast on a long table",
        "A man playing the talking drum",
        "Children dancing in matching uniforms",
        "A team holding up a trophy",
        "A house decorated with festive lights",

        "A wedding procession through a village",
        "A jazz band performing at a wedding",
        "Children playing tug-of-war at a festival",
        "A retirement party with a banner",
        "A laser light show on a stage",

        "A bride throwing a bouquet",
        "Drummers in a circle at a festival",
        "Children watching a parade pass by",
        "A community elder being honored",
        "A barbecue on a national holiday",

        "A wedding couple walking under flower petals",
        "A musician playing a wooden xylophone",
        "Children running with colorful streamers",
        "A reunion of old classmates with hugs",
        "A traditional torchlight procession",

        "A bride and groom sharing a first dance",
        "A choir performing at a Christmas service",
        "Children playing musical chairs",
        "A friend group toasting at a dinner",
        "A rooftop fireworks viewing",

        "A wedding cake with multiple tiers",
        "A young drummer practicing at sunset",
        "Children riding decorated bicycles in a parade",
        "A family welcoming a graduate at the airport",
        "A festival of lights along a riverside",

        "A bride being carried over a threshold",
        "A pianist playing at a charity event",
        "Children dressed in traditional clothes for a holiday",
        "A baby shower with gifts on a table",
        "A community parade led by elders",

        "A bride having her henna applied",
        "A drumming circle at sunset",
        "Children holding hands in a dance circle",
        "A first day of school celebration",
        "A village festival with stalls",

        "A wedding altar decorated with flowers",
        "Singers performing at an outdoor stage",
        "Children eating cake at a birthday",
        "A teacher being honored on appreciation day",
        "A wedding sparkler send-off",

        "A bride and groom posing with elders",
        "A young woman playing the violin at a celebration",
        "Children playing limbo at a beach party",
        "A grandfather's 80th birthday gathering",
        "A boat parade on a lake during a festival",

        "A bride preparing in a dressing room",
        "A street musician playing a saxophone",
        "Children blowing bubbles at a party",
        "A neighborhood block party with food stalls",
        "A drone light show over a city",
    ],
    "Storytelling": [
        # 4 prompts each
        "An elder telling stories under a baobab tree",
        "Children listening to a story by firelight",
        "A griot playing a kora",
        "A handwritten book of folktales",

        "A grandmother telling a bedtime story",
        "A village storyteller surrounded by children",
        "A musician playing the balafon",
        "A worn book of fables on a desk",

        "An old man teaching a proverb to youth",
        "Children acting out a folktale",
        "A drummer accompanying a storyteller",
        "An open scroll of myths",

        "A historian explaining a map to students",
        "Children reciting a tale together",
        "A flutist providing music to a story",
        "A library shelf full of folk-story books",

        "An elder gesturing while telling a tale",
        "Children laughing at a funny story",
        "A young man learning to play the kora",
        "A poster of a famous folktale",

        "A teacher reading a story to a class",
        "Children with eyes wide during a story",
        "A pair of musicians backing a storyteller",
        "An illustrated children's storybook",

        "A grandfather acting out characters in a story",
        "Children clapping along during a tale",
        "A storyteller with a calabash drum",
        "A handwritten poem on parchment",

        "A village chief telling a history lesson",
        "Children pointing at imaginary characters",
        "A xylophonist playing under a tree",
        "A bookshelf with old leather-bound volumes",

        "An author reading at a community center",
        "Children sitting cross-legged before a storyteller",
        "A traditional musician with face painted",
        "A notebook full of family proverbs",

        "An aunt telling a moral tale at dinner",
        "Children covering their eyes during a scary story",
        "A storyteller with a colorful staff",
        "A printed booklet of local legends",

        "A radio host telling stories on air",
        "Children retelling a story to one another",
        "A musician singing an epic poem",
        "An anthology of African folktales",

        "A poet performing on a small stage",
        "Children listening with chins on hands",
        "A duo of singers narrating a legend",
        "An illustrated map of a folktale's setting",

        "A grandmother holding a child while telling a story",
        "Children in a circle around a storyteller",
        "A man playing the ngoni at sundown",
        "A textbook chapter on oral history",

        "A village mediator telling a parable",
        "Children mimicking a storyteller's gestures",
        "A drummer warming up before a tale",
        "A booklet of riddles for children",

        "A father telling a fishing tale to his sons",
        "Children laughing with an elder in a courtyard",
        "A duo of dancers acting out a story",
        "An old cassette of recorded stories",

        "An elder pointing at the night sky during a story",
        "Children listening on a porch at twilight",
        "A guitarist accompanying a folktale",
        "A diary with handwritten stories inside",

        "A teacher dramatizing a fable for students",
        "Children gasping at a story's twist",
        "A storyteller wearing traditional regalia",
        "A school chalkboard with a moral written on it",

        "An aunt telling a wedding-day legend",
        "Children clapping at the end of a story",
        "A chorus singing the refrain of a tale",
        "A bound manuscript on a wooden table",

        "An old fisherman telling a sea story",
        "Children listening to a story in a classroom",
        "A modern poet using a microphone",
        "A children's book left open on a step",

        "A grandfather sharing a war story with grandchildren",
        "Children listening intently to an audio story on a tablet",
        "A balafon and djembe duo performing",
        "An illustrated calendar with a story for each month",
    ],
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="in_path", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)

    # Validate prompt counts up front.
    expected_per_path = {theme: count for theme, _, count in THEMES}
    for theme, _, count in THEMES:
        got = len(PROMPTS[theme])
        if got != count * 20:
            raise SystemExit(
                f"Theme '{theme}' has {got} prompts; expected {count * 20} "
                f"({count} per path × 20 paths)"
            )

    # Check for duplicates within each theme. Across-theme duplicates are
    # OK because the level-id keeps them disambiguated.
    for theme, prompts in PROMPTS.items():
        if len(set(prompts)) != len(prompts):
            dups = sorted({p for p in prompts if prompts.count(p) > 1})
            raise SystemExit(f"Duplicate prompts in theme {theme}: {dups[:5]}...")

    # Read existing rows so we can preserve any human edits to Path 1.
    preserved_rows: list[dict] = []
    if args.in_path.exists():
        with args.in_path.open(newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                if row.get("path_id") == "1":
                    preserved_rows.append(row)

    # Generate path 2..20.
    new_rows: list[dict] = []
    for path_id in range(2, 21):
        for theme, level_id, per_level in THEMES:
            base = (path_id - 1) * per_level
            for q_offset in range(per_level):
                prompt = PROMPTS[theme][base + q_offset]
                new_rows.append(
                    {
                        "path_id": str(path_id),
                        "level_id": str(level_id),
                        "q_index": str(q_offset + 1),
                        "theme": theme,
                        "prompt_en": prompt,
                        "image_concept": prompt.lower(),
                        "search_query": prompt,
                        "license_filter": "cc-or-royalty-free",
                    }
                )

    fieldnames = [
        "path_id",
        "level_id",
        "q_index",
        "theme",
        "prompt_en",
        "image_concept",
        "search_query",
        "license_filter",
    ]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(preserved_rows)
        writer.writerows(new_rows)

    total = len(preserved_rows) + len(new_rows)
    print(
        f"Wrote {total} rows ({len(preserved_rows)} preserved + {len(new_rows)} new) "
        f"to {args.out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
