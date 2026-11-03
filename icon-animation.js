/* Minecraft item texture animation: each tick is 50 ms. Shared by UI and tests. */
var McItemAnimation = (() => {
  const positive = value => Number.isInteger(value) && value > 0;
  function validMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || !metadata.animation ||
        typeof metadata.animation !== 'object' || Array.isArray(metadata.animation)) return false;
    const a = metadata.animation;
    if (['frametime', 'width', 'height'].some(key => a[key] !== undefined && !positive(a[key]))) return false;
    if (a.interpolate !== undefined && typeof a.interpolate !== 'boolean') return false;
    if (a.frames !== undefined && (!Array.isArray(a.frames) || !a.frames.every(frame =>
      Number.isInteger(frame) ? frame >= 0 : frame && typeof frame === 'object' &&
      Number.isInteger(frame.index) && frame.index >= 0 &&
      (frame.time === undefined || positive(frame.time))))) return false;
    return true;
  }
  function parse(metadata, imageWidth, imageHeight) {
    if (!validMetadata(metadata)) throw Error('动画帧或播放时间配置无效');
    const a = metadata.animation, width = a.width || imageWidth, height = a.height || width;
    if (!positive(imageWidth) || !positive(imageHeight) || imageWidth % width || imageHeight % height)
      throw Error('图像尺寸无法按动画帧大小整除');
    const columns = imageWidth / width, count = columns * imageHeight / height;
    const frames = a.frames?.length ? a.frames.map(frame => ({
      index: typeof frame === 'number' ? frame : frame.index,
      time: typeof frame === 'number' ? a.frametime || 1 : frame.time || a.frametime || 1,
    })) : Array.from({length: count}, (_, index) => ({index, time: a.frametime || 1}));
    if (frames.some(frame => frame.index >= count)) throw Error('动画引用了图像中不存在的帧');
    return {width, height, columns, count, frames, interpolate: !!a.interpolate,
      duration: frames.reduce((sum, frame) => sum + frame.time * 50, 0)};
  }
  function frameAt(animation, milliseconds) {
    let time = ((milliseconds % animation.duration) + animation.duration) % animation.duration;
    for (let n = 0; n < animation.frames.length; n++) {
      const frame = animation.frames[n], duration = frame.time * 50;
      if (time < duration) return {index: frame.index,
        next: animation.frames[(n + 1) % animation.frames.length].index,
        blend: animation.interpolate ? time / duration : 0};
      time -= duration;
    }
    return {index: animation.frames[0].index, next: animation.frames[0].index, blend: 0};
  }
  return {validMetadata, parse, frameAt};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = McItemAnimation;
