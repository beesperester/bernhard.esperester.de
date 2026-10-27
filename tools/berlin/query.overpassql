[out:json][timeout:180];
(
  way["waterway"~"^(river|canal)$"](52.462,13.270,52.556,13.480);
  way["natural"="water"](52.462,13.270,52.556,13.480);
  relation["natural"="water"](52.462,13.270,52.556,13.480);
  way["highway"~"^(motorway|trunk|primary)$"](52.462,13.270,52.556,13.480);
  way["leisure"="park"](52.462,13.270,52.556,13.480);
  relation["leisure"="park"](52.462,13.270,52.556,13.480);
  way["landuse"~"^(forest|cemetery|allotments|meadow|grass)$"](52.462,13.270,52.556,13.480);
  way["natural"="wood"](52.462,13.270,52.556,13.480);
  relation["route"="light_rail"]["ref"="S41"];
);
out geom;
