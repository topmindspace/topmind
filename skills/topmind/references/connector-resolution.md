# Connector Category Resolution

`topmind-weread` / `topmind-x` 同步目标类别优先级：

1. `topmind.yaml` → `connectorDefaults.{weread|x}.syncCategory` 显式值（非 `auto`）  
2. 模板 `connectorHints`：`preferSlot` → `preferRole` + `nameKeywords`  
3. 首个 `role: deep-work` → 首个 `loose-stream` → `buffer`  

`syncCategory: "auto"` 走 2–3。

Connector 是**可选** skill（`optional: true`），不纳入核心 7 skill 强制依赖。  
