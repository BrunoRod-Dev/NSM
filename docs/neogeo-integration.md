# Neo Geo integration

Metal Slug 1 and 2 are enabled for owner gameplay validation, not certified as runtime-tested.
The local NeoRage-style resources were normalized by CRC and size against FBNeo ROM descriptors.
Metal Slug 1 C ROMs require swapping their two halves. Metal Slug 2 matches after excluding commented-out alternative board entries in the descriptor.
Only exact CRC/size matches are included. Originals remain unchanged. Private normalized ZIPs and BIOS stay outside Git.

The library keeps the existing game.chd / bios.bin transport aliases, but the Neo Geo adapter supplies named mslug.zip / mslug2.zip and neogeo.zip Files to EmulatorJS.
Each participant installs and executes the same game and pinned legacy arcade core. Frame coordination and host snapshots reuse the PS1 session implementation; arcade checkpoints compare the serialized core MEM payload rather than PS1 RAM offsets.
Guest saves are session-local. The host owns persistent saves. Core and resource hashes must match before synchronization.

Verification performed: archive CRC checks, descriptor matching, JavaScript syntax and production compilation. No browser or gameplay tests performed. Owner must validate boot, coin/start, two-player movement/actions, checkpoints, reconnect and host save persistence.
Metal Slug X has a corrupt MSX_C3.rom entry. The supplied Metal Slug 3/5 sets do not match their original encrypted boards. They remain disabled, as does absent Metal Slug 4.
