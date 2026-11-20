+++
title = "Registering a Glowing Frost Lantern with DeferredRegister"
summary = "Master Forge's deferred registration lifecycle, pair a Block with its BlockItem, and tune snow-safe light levels."
step_number = 1
estimated_minutes = 8
synced_revision = 1
canonical_revision = 1
tags = ["Minecraft-Mod", "Forge", "Java"]
+++

## Understanding the `DeferredRegister` Lifecycle

In Minecraft Forge, blocks and items must enter the registry during `RegisterEvent`. Using `DeferredRegister` lets you declare a glowing Frost Lantern cleanly and attach it to the mod event bus in one step:
:::margin[Modder Tip: Without a matching BlockItem, players can't hold or place the block from their inventory!]

```java title="src/main/java/com/example/frostmod/ModBlocks.java"
public class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS =
        DeferredRegister.create(ForgeRegistries.BLOCKS, FrostMod.MOD_ID);

    public static final RegistryObject<Block> SNOW_LANTERN = BLOCKS.register(
        "snow_lantern",
        () -> new Block(BlockBehaviour.Properties.of()
            .strength(1.5f)
            .sound(SoundType.GLASS)
            .lightLevel(state -> 14))
    );
}
```

- [ ] Register both `SNOW_LANTERN` and its matching `BlockItem` in `ModBlocks` | Attach `BLOCKS.register(modEventBus)` inside your mod constructor

## Tuning Light Levels for Snow Biomes

:::tip[Keep Surrounding Snow from Melting]
Vanilla ice and snow layers melt at block light `>= 12`. To preserve snowy streets at night, either override melt behavior or tune `lightLevel` to `11`.
:::

- [ ] Launch the Minecraft client and test placing the lantern at night | Verify the held item model, glass sound, and lighting level in-world
