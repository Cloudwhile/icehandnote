+++
title = "使用 DeferredRegister 注册发光冰晶灯笼方块"
summary = "理解 Forge 延迟注册时序，同时绑定 Block 与对应的 BlockItem，并设置柔和冰蓝光照。"
step_number = 1
estimated_minutes = 8
synced_revision = 1
canonical_revision = 1
tags = ["Minecraft-Mod", "Forge", "Java"]
+++

## 理解 `DeferredRegister` 的注册生命周期

在 Minecraft Forge 中，方块与物品必须在特定的 `RegisterEvent` 阶段注入游戏注册表。通过 `DeferredRegister`，我们可以安全地以静态常量声明“冰晶灯笼”方块，再统一挂载至模组事件总线：
:::margin[小提示：忘记同时注册 BlockItem 的话，方块就没办法拿在手上哦！]

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

- [ ] 在 `ModBlocks` 中注册 `SNOW_LANTERN` 方块及其对应的 `BlockItem` | 并将 `BLOCKS.register(modEventBus)` 挂载到模组构造函数中

## 光照等级与雪地氛围调校

:::tip[避免融化周围积雪的光照建议]
原版冰块与积雪在方块光照 `>= 12` 时会开始融化。如果希望保留雪地夜景且不融雪，建议覆写融雪条件或将 `lightLevel` 调整为 `11`。
:::

- [ ] 启动游戏客户端验证方块放置与夜间发光效果 | 确认手持物品模型、放置音效与光照等级均符合预期
