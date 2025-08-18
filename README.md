# TownyAI Mineflayer

this repository contains the scripts for townyAI bots. These bots are instantiated and managed through the TownyAI plugin. While they feature autonomous behavior in combat and other tasks, they have enhanced gamesense through integration with the TownyAI plugin to allow them to engage in warfare in a much more natural way.

The main method of utilizing these bots to their full extent is with townyAI. a lot of features are dependent on TownyAI to function. While its possible to use them without townyAI, it is not particularly recommended. 

Starting a townyAI-mineflayer instance is as simple as configuring the IP of the bots and instancing the admin bot with node. the admin bots commands can be found in its script. This readme is ass because this plugin was primarily created for internal use only, but it shouldnt be hard to figure out the commands and arguments. 


# bots

### adminbot
this bot simply recieves orders from the TownyAI plugin to instantiate other bots, acting as the most reliablle connection between the TownyAI plugin and the mineflayer service. it makes reconnection attempts and can queue bot spawns to prevent failiure when overloaded.

### townleaderbot
this is a bot which handles the creation of new AI towns. it is primarily used as a vector for the town creation workflow, and does not do much else once the town has been created. 

### fighterbot
currently the most advanced bot in townyAI. This bot features configurable combat stats and integration with TownyAI to allow it to defend flag war attacks on the townyAI town. it stores information on its allies, flags which have been placed, and can be live configured by the plugin.


