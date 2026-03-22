import { ActorType, RoundStageName, TurnSpeed } from '@system/types/cosmere';

import { CosmereCombatant } from './combatant';

// Constants
import { SYSTEM_ID } from '@system/constants';
import { CombatantInStageFunc, RoundStageConfig } from '../types/config';

export class RoundStage {
    stageSpeed?: TurnSpeed;
    stageActorType?: ActorType;
    combatantInStageFunc?: CombatantInStageFunc;
    public participants: CosmereCombatant[];
    private combat: CosmereCombat;
    constructor(combat: CosmereCombat, config: RoundStageConfig) {
        this.combat = combat;
        this.stageSpeed = config.stageSpeed;
        this.stageActorType = config.stageActorType;
        this.combatantInStageFunc = config.combatantInStageFunc;
        this.participants = [];
    }
    public async updateParticipants() {
        this.participants = this.combat.turns.filter(async (combatant) => {
            let isInRound = false;
            // If this stage has a defined "Is in stage" function, use that instead of speed/actor type
            if (this.combatantInStageFunc) {
                return await this.combatantInStageFunc(combatant);
            }

            // Check if this combatant matches this round's speed
            if (this.stageSpeed) {
                isInRound =
                    isInRound && combatant.turnSpeed === this.stageSpeed;
            }

            // Check if this combatant matches this round's actor type
            if (this.stageActorType) {
                isInRound =
                    isInRound && combatant.actor.type === this.stageActorType;
            }

            return isInRound;
        });
        // Included to avoid eslint error from "Function has no await"
        await Promise.resolve();
    }
}

export class CosmereCombat extends Combat {
    private stage: RoundStage | undefined;

    /**
     * Generates the round stages from config, and populates them with an empty combatant array.
     */
    roundStages: Record<string, RoundStage> = Object.keys(
        CONFIG.COSMERE.combat.stages,
    ).reduce(
        (prev: Record<string, RoundStage>, curr: string) => {
            const stage = CONFIG.COSMERE.combat.stages[curr];
            prev[curr] = new RoundStage(
                this,
                CONFIG.COSMERE.combat.stages[curr],
            );
            return prev;
        },
        {} as Record<string, RoundStage>,
    );

    public get currentStage(): RoundStage {
        return this.stage ?? Object.values(this.roundStages)[0];
    }

    public set currentStage(stage) {
        this.stage = stage;
    }

    public async updateStageParticipants() {
        for (const stage of Object.values(this.roundStages)) {
            await stage.updateParticipants();
        }
    }

    /**
     * Sets all defeated combatants activation status to true (already activated),
     * and all others to false (hasn't activated yet)
     */
    resetActivations() {
        this.turns.forEach((combatant) => void combatant.resetActivation());
    }

    override async startCombat(): Promise<this> {
        this.resetActivations();
        this._playCombatSound('startEncounter');
        await this.updateStageParticipants();

        const updateData = {
            round: 1,
            turn: this.turns.indexOf(this.currentStage.participants[0]),
        };
        Hooks.callAll('combatStart', this, updateData);
        await this.update(updateData);
        return this;
    }

    override async nextRound(): Promise<this> {
        this.resetActivations();

        // Ensure that at the start of the round, it's no combatant's turn
        await this.update({ round: this.round, turn: null });

        // super.nextRound() handles worldtime updates, so we don't need to worry about this
        return super.nextRound();
    }

    override async nextTurn(): Promise<this> {
        // The Cosmere RPG doesn't have an easy programmatic "next turn",
        // so we should reset the combat tracker to be no-one's turn when
        // the nextTurn button is pressed.
        if (this.turn === null) {
            return this;
        }
        let advanceTime;
        if (this.turns.length > this.turn + 1) {
            advanceTime = this.getTimeDelta(
                this.round,
                this.turn,
                this.round,
                this.turn + 1,
            );
        } else advanceTime = 0;
        const updateData = { round: this.round, turn: null };
        const updateOptions: Combat.Database.UpdateOperation = {
            direction: 1,
            worldTime: { delta: advanceTime },
        };

        await this.update(updateData, updateOptions);
        return this;
    }

    override setupTurns(): CosmereCombatant[] {
        this.turns ??= [];
        let currTurnId: string | undefined | null;
        if (this.current) {
            currTurnId = this.current.combatantId;
        }

        // One-time initialization of the previous state
        if (!this.previous) this.previous = this.current;

        const turns = Array.from(this.combatants).sort(
            this._sortCombatants.bind(this),
        );

        // Assign turns
        this.turns = turns;

        // Update state tracking
        if (currTurnId) {
            this.turn = turns.findIndex((combatant) => {
                return combatant.id == currTurnId;
            });
            const c = turns[this.turn];
            this.current = this._getCurrentState(c);
        }

        if (this.turn !== null)
            this.turn = Math.clamp(this.turn, 0, turns.length - 1);

        // Return the array of prepared turns
        return this.turns;
    }

    override async _onEnter(combatant: CosmereCombatant) {
        // If the combatant is a boss, clone it to create a fast turn beside its slow turn
        if (combatant.isBoss && combatant.turnSpeed == TurnSpeed.Slow) {
            const createData: Combatant.CreateData = {
                tokenId: combatant.tokenId,
                sceneId: combatant.sceneId,
                actorId: combatant.actorId,
                hidden: combatant.hidden,
                flags: {
                    [SYSTEM_ID]: {
                        turnSpeed: TurnSpeed.Fast,
                    },
                },
            };
            void (await this.createLinkedCombatants(combatant, [createData]));
        }
        void (await this.updateStageParticipants());
    }

    async createLinkedCombatants(
        combatant: CosmereCombatant,
        data: Combatant.CreateData[],
    ) {
        const linkedCombatants: CosmereCombatant[] =
            await this.createEmbeddedDocuments('Combatant', data);
        const linkedCombatantIds: string[] = [combatant.id!];
        for (const linkedCombatant of linkedCombatants) {
            linkedCombatantIds.push(linkedCombatant.id!);
        }
        void (await combatant.setFlag(
            SYSTEM_ID,
            'linkedCombatantIds',
            linkedCombatantIds.filter((id) => id !== combatant.id),
        ));
        for (const linkedCombatant of linkedCombatants) {
            void (await linkedCombatant.setFlag(
                SYSTEM_ID,
                'linkedCombatantIds',
                linkedCombatantIds.filter((id) => id !== linkedCombatant.id),
            ));
        }
    }

    public async setCurrentTurnFromCombatant(combatant: CosmereCombatant) {
        const turnIndex = this.turns.indexOf(combatant);

        if (turnIndex !== -1) {
            const updateData = { round: this.round, turn: turnIndex };
            const updateOptions = {
                advanceTime: 0,
                direction: 1,
            };
            Hooks.callAll('combatTurn', this, updateData, updateOptions);
            await this.update(
                updateData,
                updateOptions as Combat.Database.UpdateOperation,
            );
        }
    }
}

declare module '@league-of-foundry-developers/foundry-vtt-types/configuration' {
    interface ConfiguredCombat<SubType extends Combat.SubType> {
        document: CosmereCombat;
    }
}
