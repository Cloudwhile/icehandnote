+++
title = "使用 DeferredRegister 註冊發光冰晶燈籠方塊"
summary = "理解 Forge 延遲註冊時序，同時綁定 Block 與對應的 BlockItem，並設定柔和冰藍光照。"
step_number = 1
estimated_minutes = 8
synced_revision = 1
canonical_revision = 1
tags = ["Minecraft-Mod", "Forge", "Java"]
+++

## 理解 `DeferredRegister` 的註冊生命週期

在 Minecraft Forge 中，方塊與物品必須在特定的 `RegisterEvent` 階段注入遊戲註冊表。透過 `DeferredRegister`，我們可以安全地以靜態常數宣告「冰晶燈籠」方塊，再統一掛載至模組事件匯流排：
:::margin[模組筆記：忘記同時註冊 BlockItem 的話，方塊就沒辦法拿在手上喔！]

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

:::tip[光照等級與雪地氛圍調校]
原版冰塊與積雪在方塊光照 `>= 12` 時會開始融化。若希望保留雪地夜景且不融雪，建議覆寫融雪條件或將 `lightLevel` 調整為 `11`！
:::
