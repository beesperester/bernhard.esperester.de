import { screenLight, sunLight } from '../art/lighting.ts';
import type { Light } from '../world/sky.ts';
import { paintLight } from './Painted.ts';

// Keeps the garden's modelled things lit from where the sun actually is: the
// trees, and the bushes and rocks in the ground, are shaded on the GPU from
// their normals (Painted.ts), in the light as it is each frame. (Pictures
// still drawn on the CPU, like a tree's reflection, are drawn in it too.)
// Bushes and rocks up on the raised terrain keep the light they were drawn in.

export class Lighting {
  update(light: Light): void {
    const L = screenLight(light.sunDir, light.elevation, light.day);
    Object.assign(sunLight, L);
    paintLight.sun[0] = L.x;
    paintLight.sun[1] = L.y;
    paintLight.sun[2] = L.k;
  }
}
