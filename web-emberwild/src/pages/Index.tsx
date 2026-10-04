import { useEffect } from "react";
import { BattleScreen } from "@/components/game/BattleScreen";
import { CreateScreen } from "@/components/game/CreateScreen";
import { GameScreen } from "@/components/game/GameScreen";
import { TitleScreen } from "@/components/game/TitleScreen";
import { playMusic, setScreen, useGame } from "@/game/store";

const Index = () => {
  const { screen, gs, v } = useGame();

  useEffect(() => {
    const unlock = (): void => {
      playMusic(gs?.battle ? "battle" : "wilds");
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (screen === "create") return <CreateScreen />;
  if (screen === "game" && gs) {
    if (gs.battle) return <BattleScreen gs={gs} v={v} />;
    return <GameScreen />;
  }
  return <TitleScreen onNewJourney={() => setScreen("create")} />;
};

export default Index;
