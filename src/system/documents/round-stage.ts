import { ActorType, TurnSpeed } from '../types/cosmere';
import { CosmereCombatant } from './combatant';

export interface RoundStageData {
    stageSpeed: TurnSpeed;
    stageActorType: ActorType;
}

export class RoundStage implements RoundStageData {
    stageSpeed: TurnSpeed;
    stageActorType: ActorType;
    participants: CosmereCombatant[] = [];

    constructor(stageData?: RoundStageData) {
        this.stageSpeed = stageData?.stageSpeed ?? TurnSpeed.Fast;
        this.stageActorType = stageData?.stageActorType ?? ActorType.Character;
    }

    static getInitialStages() {
        const stages = {} as Record<string, RoundStage>;
        for (const key of Object.keys(CONFIG.COSMERE.combat.stages)) {
            const stage = CONFIG.COSMERE.combat.stages[key];
            stages[key] = new RoundStage(stage);
        }
        return stages;
    }

    private activeParticipant: CosmereCombatant | undefined;

    get currentParticipant() {
        return this.activeParticipant ?? this.participants[0];
    }
    set currentParticipant(combatant) {
        if (this.participants.includes(combatant)) {
            this.activeParticipant = combatant;
        }
    }

    get populated(): boolean {
        return this.participants.length > 0;
    }

    updateParticipants(combatants: CosmereCombatant[]) {
        this.participants = combatants.filter(
            (combatant) =>
                combatant.turnSpeed === this.stageSpeed &&
                combatant.actor.type === this.stageActorType,
        );
    }
}
