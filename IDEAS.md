Instead of component D was rendered bc of component parent

It would be sick to know EXACTLY what happened up the tree.

i.e.

`component ___ that you've highlighted is rendering bc state ____ from component/context ____ has changed from ____ to ____`

---

there has to be a way to detect infinite renders more quickly. Would be great if it could be auto detected if the cost isn't too high.

what could the intersection of react fiber internals coupled with tracked metrics and ability to pause, step execution.

perhaps you can set a breakpoint on a useEffect within a component. Then it hits the breakpoint and you constantly se: "re-executing bc of **\_** value from **\_** component" then that at least helps?

Problems ppl have faced:
https://x.com/aidenybai/status/1941988096268263896
https://x.com/codingmickey/status/1778787761656361367
https://x.com/edwnjos/status/1936198079515861493
https://x.com/evgenypelican/status/1938434299751272839

problems I've faced:
using context outside of provider. It would be nice to be able to see tree hierarchy? where is the provider component wise vs where am I(maybe this is just a novelty)
