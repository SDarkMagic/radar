export type Vec3 = [number, number, number];

export interface ResPlacementObj {
  readonly '!Parameters': { [key: string]: any };
  readonly SRTHash: number;
  readonly HashId: number;
  readonly OnlyOne?: boolean;
  readonly UniqueName?: string;
  readonly UnitConfigName: string;
  readonly LinksToObj?: any;
  readonly LinksToRail?: any;
  readonly Translate: Vec3;
  readonly Scale?: Vec3;
  readonly Rotate?: Vec3;
};

export class PlacementObj {
  static genGroupCounter = 0;
  constructor(public readonly data: ResPlacementObj) { }
  links: PlacementLink[] = [];
  linksToSelf: PlacementLink[] = [];
  genGroupId = -1;
}

export class PlacementLink {
  constructor(public readonly otherObj: PlacementObj,
    public readonly linkIter: any,
    public readonly ltype: string,
  ) { }
}

export interface ResRail {
  readonly '!Parameters': { [key: string]: any };
  readonly HashId: number;
  readonly IsClosed: boolean;
  readonly RailPoints: any[];
}
export class Rail {
  constructor(public readonly data: ResRail) { }
}

export class PlacementMap {
  constructor(public type: string, public name: string, data: any) {
    this.data = data;
    this.initObjects();
    this.buildGenGroups();
  }

  getObjs() {
    return this.objs.values();
  }
  getRails() {
    return this.rails.values();
  }

  getObj(hashid: number): PlacementObj {
    return (this.objs.get(hashid))!;
  }

  private buildGenGroup(obj: PlacementObj): void {
    const doBuild = (obj: PlacementObj, id: number) => {
      try{
        if (obj.genGroupId != -1)
          return;
        obj.genGroupId = id;
        for (const link of obj.links)
          doBuild(link.otherObj, id);
        for (const link of obj.linksToSelf)
          doBuild(link.otherObj, id);
      } catch (err) {
        console.log(id, err)
      }
    }

    doBuild(obj, PlacementObj.genGroupCounter++);
  }

  private buildGenGroups() {
    for (const obj of this.objs.values()) {
      if (obj.genGroupId != -1)
        continue;
      this.buildGenGroup(obj);
    }
  }

  private initObjects() {
    for (const obj of this.data.Objs) {
      this.objs.set(obj.HashId, new PlacementObj(obj));
    }

    for (const obj of this.objs.values()) {
      const links = obj.data.LinksToObj;
      if (!links)
        continue;

      for (const link of links) {
        try {
          const destObj = (this.objs.get(link.DestUnitHashId))!;
          obj.links.push(new PlacementLink(destObj, link, link.DefinitionName));
          destObj.linksToSelf.push(new PlacementLink(obj, link, link.DefinitionName));
        } catch(err) {
          console.log(err, link)
        }
      }
    }
    for (const obj of this.data.Rails) {
      this.rails.set(obj.HashId, new Rail(obj));
    }
  }

  private data: any;
  private objs: Map<number, PlacementObj> = new Map();
  private rails: Map<number, Rail> = new Map();
}
