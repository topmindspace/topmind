type OpenCodeApp = {
  log?: {
    info?: (message: string) => void;
  };
};

export default async function topmindPlugin(app?: OpenCodeApp) {
  app?.log?.info?.("topmind skill pack loaded");

  return {
    name: "topmind",
    contentTruth: "topmind-workspace",
    dailyEntry: "topmind",
    writesContent: false,
    capabilities: ["skills", "mcp", "commands", "plugin"],
  };
}
