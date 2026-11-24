
import * as THREE from 'three/webgpu'
import { pass, renderOutput } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { Inspector } from 'three/addons/inspector/Inspector.js'

import { Game } from './Game.js'
import { cheapDOF } from './Passes/cheapDOF.js'


export class Rendering
{
    constructor()
    {
        this.game = Game.getInstance()

        if(this.game.debug.active)
        {
            this.debugPanel = this.game.debug.panel.addFolder({
                title: '📸 Rendering',
                expanded: false,
            })
        }
    }

    start()
    {
        this.setStats()

        this.game.ticker.events.on('tick', () =>
        {
            this.render()
        }, 998)

        this.game.viewport.events.on('change', () =>
        {
            this.resize()
        })
    }

    async setRenderer()
    {
        // WebGPU requires strict integer draw parameters.
        // Three.js draw data can contain stale or undefined values while resources
        // are loading, which WebIDL otherwise converts into uncaught TypeErrors.
        if(
            typeof GPURenderPassEncoder !== 'undefined' &&
            !GPURenderPassEncoder.prototype.__drawIndexedDebug
        )
        {
            const originalDrawIndexed =
                GPURenderPassEncoder.prototype.drawIndexed

            let reported = false

            GPURenderPassEncoder.prototype.drawIndexed = function(...args)
            {
                const safeUnsigned = (value, maximum = 4294967295) =>
                {
                    if(!Number.isFinite(value))
                        return 0

                    return Math.min(maximum, Math.max(0, Math.trunc(value)))
                }

                const safeSigned = (value) =>
                {
                    if(!Number.isFinite(value))
                        return 0

                    return Math.min(
                        2147483647,
                        Math.max(-2147483648, Math.trunc(value))
                    )
                }

                const originalArgs = args.slice()
                const safeArgs = [
                    safeUnsigned(originalArgs[0]),
                    safeUnsigned(originalArgs[1]),
                    safeUnsigned(originalArgs[2]),
                    safeSigned(originalArgs[3]),
                    safeUnsigned(originalArgs[4])
                ]

                if(safeArgs[0] === 0 || safeArgs[1] === 0)
                    return

                const invalid = originalArgs.some((value, index) =>
                {
                    if(index === 3)
                        return !Number.isInteger(value)

                    return !Number.isInteger(value)
                })

                if(invalid && !reported)
                {
                    reported = true
                    console.warn(
                        'WebGPU skipped malformed drawIndexed parameters.',
                        { originalArgs, safeArgs }
                    )
                }

                return originalDrawIndexed.apply(this, safeArgs)
            }

            GPURenderPassEncoder.prototype.__drawIndexedDebug = true

            console.log('🛠️ WebGPU drawIndexed debugger installed')
        }

        // WebGPU Renderer
        this.renderer = new THREE.WebGPURenderer({
            canvas: this.game.canvasElement,
            powerPreference: 'high-performance',
            forceWebGL: false,
            antialias: this.game.viewport.pixelRatio < 2
        })

        this.renderer.setSize(
            this.game.viewport.width,
            this.game.viewport.height
        )

        this.renderer.setPixelRatio(this.game.viewport.pixelRatio)

        this.renderer.sortObjects = false

        this.renderer.domElement.classList.add('experience')

        this.renderer.shadowMap.enabled = true

        // Object sorting
        this.renderer.setOpaqueSort((a, b) =>
        {
            return a.renderOrder - b.renderOrder
        })

        this.renderer.setTransparentSort((a, b) =>
        {
            return a.renderOrder - b.renderOrder
        })

        // Inspector
        if(location.hash.match(/inspector/i))
        {
            this.renderer.inspector = new Inspector()
        }

        // Renderer controls the ticker
        this.renderer.setAnimationLoop((elapsedTime) =>
        {
            this.game.ticker.update(elapsedTime)
        })

        await this.renderer.init()

        console.log('✅ WebGPU Renderer initialized')

        return this.renderer
    }

    setPostprocessing()
    {
        this.postProcessing = new THREE.RenderPipeline(this.renderer)

        const scenePass = pass(
            this.game.scene,
            this.game.view.camera
        )

        const scenePassColor = scenePass.getTextureNode('output')

        // Bloom
        this.bloomPass = bloom(scenePassColor)

        this.bloomPass._nMips =
            this.game.quality.level === 0 ? 5 : 2

        this.bloomPass.threshold.value = 1
        this.bloomPass.strength.value = 0.25
        this.bloomPass.smoothWidth.value = 1

        // Depth of Field
        this.cheapDOFPass = cheapDOF(renderOutput(scenePass))

        // Quality settings
        const qualityChange = (level) =>
        {
            if(level === 0)
            {
                this.postProcessing.outputNode =
                    this.cheapDOFPass.add(this.bloomPass)
            }
            else if(level === 1)
            {
                this.postProcessing.outputNode =
                    scenePassColor.add(this.bloomPass)
            }

            this.postProcessing.needsUpdate = true
        }

        qualityChange(this.game.quality.level)

        this.game.quality.events.on('change', qualityChange)

        // Debug panels
        if(this.game.debug.active)
        {
            const bloomPanel = this.debugPanel.addFolder({
                title: 'bloom',
                expanded: false,
            })

            bloomPanel.addBinding(
                this.bloomPass.threshold,
                'value',
                {
                    label: 'threshold',
                    min: 0,
                    max: 2,
                    step: 0.01
                }
            )

            bloomPanel.addBinding(
                this.bloomPass.strength,
                'value',
                {
                    label: 'strength',
                    min: 0,
                    max: 3,
                    step: 0.01
                }
            )

            bloomPanel.addBinding(
                this.bloomPass.radius,
                'value',
                {
                    label: 'radius',
                    min: 0,
                    max: 1,
                    step: 0.01
                }
            )

            bloomPanel.addBinding(
                this.bloomPass.smoothWidth,
                'value',
                {
                    label: 'smoothWidth',
                    min: 0,
                    max: 1,
                    step: 0.01
                }
            )

            const blurPanel = this.debugPanel.addFolder({
                title: 'blur',
                expanded: true,
            })

            blurPanel.addBinding(
                this.cheapDOFPass.start,
                'value',
                {
                    label: 'start',
                    min: 0,
                    max: 0.5,
                    step: 0.001
                }
            )

            blurPanel.addBinding(
                this.cheapDOFPass.end,
                'value',
                {
                    label: 'end',
                    min: 0,
                    max: 0.5,
                    step: 0.001
                }
            )

            blurPanel.addBinding(
                this.cheapDOFPass.repeats,
                'value',
                {
                    label: 'repeats',
                    min: 1,
                    max: 100,
                    step: 1
                }
            )

            blurPanel.addBinding(
                this.cheapDOFPass.amount,
                'value',
                {
                    label: 'amount',
                    min: 0,
                    max: 0.02,
                    step: 0.0001
                }
            )
        }
    }

    setStats()
    {
        if(!location.hash.match(/stats/i))
            return

        this.stats = {}
        this.stats.feed = {}

        this.stats.update = () =>
        {
            this.stats.feed.drawCalls =
                this.renderer.info.render.drawCalls.toLocaleString()

            this.stats.feed.triangles =
                this.renderer.info.render.triangles.toLocaleString()

            this.stats.feed.geometries =
                this.renderer.info.memory.geometries.toLocaleString()

            this.stats.feed.textures =
                this.renderer.info.memory.textures.toLocaleString()
        }

        this.stats.update()

        if(this.game.debug.active)
        {
            const debugPanel = this.debugPanel.addFolder({
                title: 'Stats',
                expanded: true,
            })

            for(const feedName in this.stats.feed)
            {
                debugPanel.addBinding(
                    this.stats.feed,
                    feedName,
                    {
                        readonly: true
                    }
                )
            }
        }
    }

    resize()
    {
        this.renderer.setSize(
            this.game.viewport.width,
            this.game.viewport.height
        )

        this.renderer.setPixelRatio(
            this.game.viewport.pixelRatio
        )
    }

    render()
    {
        // IMPORTANT:
        // RenderPipeline already renders the scene.
        // Do not call renderer.render() separately.
        this.postProcessing.render()

        if(this.stats)
        {
            this.stats.update()
        }

        if(this.game.monitoring?.stats)
        {
            this.game.rendering.renderer.resolveTimestampsAsync(
                THREE.TimestampQuery.RENDER
            )

            this.game.monitoring.stats.update()
        }
    }
}
